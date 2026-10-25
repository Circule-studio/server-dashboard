// Intégrations : récupère et normalise les données des services (Jellyfin, Plex, qBittorrent, Sonarr, Radarr).

const http = require('http');
const https = require('https');

// Les erreurs réseau de Node (ECONNREFUSED…) n'ont souvent pas de message lisible.
const NETWORK_ERRORS = {
  ECONNREFUSED: 'Service injoignable (connexion refusée)',
  ENOTFOUND: 'Adresse introuvable',
  EHOSTUNREACH: 'Hôte injoignable',
  ECONNRESET: 'Connexion interrompue',
  ETIMEDOUT: 'Délai dépassé',
};

function networkError(e) {
  return new Error(NETWORK_ERRORS[e.code] || e.message || e.code || 'Erreur réseau');
}

// `discardBody` : on ne lit que le code HTTP (utile pour un simple ping).
function request(url, { method = 'GET', headers = {}, body, timeout = 8000, discardBody = false } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('URL invalide')); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers, timeout, rejectUnauthorized: false }, (res) => {
      if (discardBody) {
        res.destroy();
        return resolve({ status: res.statusCode, headers: res.headers });
      }
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (text += d));
      res.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* pas du JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Délai dépassé'), { code: 'ETIMEDOUT' })));
    req.on('error', (e) => reject(networkError(e)));
    if (body) req.write(body);
    req.end();
  });
}

const join = (base, p) => base.replace(/\/+$/, '') + p;
const pad = (n) => String(n ?? 0).padStart(2, '0');

async function getJson(url, headers = {}) {
  const r = await request(url, { headers: { Accept: 'application/json', ...headers } });
  if (r.status === 401 || r.status === 403) throw new Error('Authentification refusée (vérifie la clé API)');
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  if (r.json === null) throw new Error('Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

// ---------- Jellyfin ----------
async function jellyfin(w) {
  const h = { 'X-Emby-Token': w.apiKey };
  const [sessions, counts] = await Promise.all([
    getJson(join(w.url, '/Sessions?activeWithinSeconds=600'), h),
    getJson(join(w.url, '/Items/Counts'), h),
  ]);
  return {
    stats: [
      { label: 'Films', value: counts.MovieCount },
      { label: 'Séries', value: counts.SeriesCount },
      { label: 'Épisodes', value: counts.EpisodeCount },
    ],
    sessions: sessions.filter((s) => s.NowPlayingItem).map((s) => {
      const it = s.NowPlayingItem;
      const episode = it.Type === 'Episode';
      return {
        user: s.UserName,
        device: s.DeviceName,
        title: episode ? `${it.SeriesName} — S${pad(it.ParentIndexNumber)}E${pad(it.IndexNumber)}` : it.Name,
        subtitle: episode ? it.Name : (it.ProductionYear ? String(it.ProductionYear) : ''),
        progress: it.RunTimeTicks ? (s.PlayState?.PositionTicks || 0) / it.RunTimeTicks : 0,
        paused: !!s.PlayState?.IsPaused,
      };
    }),
  };
}

// ---------- Plex ----------
async function plex(w) {
  const h = { 'X-Plex-Token': w.apiKey };
  const [status, libs] = await Promise.all([
    getJson(join(w.url, '/status/sessions'), h),
    getJson(join(w.url, '/library/sections'), h),
  ]);
  const items = status.MediaContainer?.Metadata || [];
  const dirs = libs.MediaContainer?.Directory || [];
  return {
    stats: [
      { label: 'Bibliothèques', value: dirs.length },
      { label: 'Lectures', value: items.length },
    ],
    sessions: items.map((m) => {
      const episode = m.type === 'episode';
      return {
        user: m.User?.title,
        device: m.Player?.title,
        title: episode ? `${m.grandparentTitle} — S${pad(m.parentIndex)}E${pad(m.index)}` : m.title,
        subtitle: episode ? m.title : (m.year ? String(m.year) : ''),
        progress: m.duration ? (m.viewOffset || 0) / m.duration : 0,
        paused: m.Player?.state === 'paused',
      };
    }),
  };
}

// ---------- qBittorrent ----------
const qbitSids = new Map(); // id du widget -> cookie SID ('' si l'auth est désactivée)

async function qbitLogin(w) {
  const body = new URLSearchParams({ username: w.username, password: w.password }).toString();
  const r = await request(join(w.url, '/api/v2/auth/login'), {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      Referer: w.url,
      Origin: new URL(w.url).origin,
    },
  });
  if (r.status === 403) throw new Error('IP bannie par qBittorrent (trop de tentatives)');
  const sid = (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('SID='));
  if (sid) return sid;
  if (r.text.trim() === 'Ok.') return ''; // authentification contournée (réseau local autorisé)
  throw new Error('Identifiants qBittorrent refusés');
}

async function qbitGet(w, path, retry = true) {
  if (!qbitSids.has(w.id)) qbitSids.set(w.id, await qbitLogin(w));
  const r = await request(join(w.url, path), { headers: { Cookie: qbitSids.get(w.id), Referer: w.url } });
  if (r.status === 403 && retry) {
    qbitSids.delete(w.id);
    return qbitGet(w, path, false);
  }
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return r.json;
}

const QBIT_STATES = {
  downloading: ['downloading', 'stalledDL', 'metaDL', 'forcedDL', 'queuedDL', 'checkingDL', 'forcedMetaDL'],
  seeding: ['uploading', 'stalledUP', 'forcedUP', 'queuedUP', 'checkingUP'],
  paused: ['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP'],
};
const qbitGroup = (state) =>
  Object.keys(QBIT_STATES).find((g) => QBIT_STATES[g].includes(state)) || (state === 'error' || state === 'missingFiles' ? 'error' : 'other');

async function qbittorrent(w) {
  const info = await qbitGet(w, '/api/v2/transfer/info');
  const torrents = await qbitGet(w, '/api/v2/torrents/info');
  const counts = { downloading: 0, seeding: 0, paused: 0, error: 0 };
  const list = torrents.map((t) => {
    const group = qbitGroup(t.state);
    if (group in counts) counts[group]++;
    return { name: t.name, progress: t.progress, dlspeed: t.dlspeed, upspeed: t.upspeed, eta: t.eta, size: t.size, group };
  });
  // Les téléchargements actifs d'abord, puis les plus rapides.
  const order = { downloading: 0, error: 1, seeding: 2, other: 3, paused: 4 };
  list.sort((a, b) => order[a.group] - order[b.group] || b.dlspeed - a.dlspeed || b.upspeed - a.upspeed);
  return {
    download: info.dl_info_speed,
    upload: info.up_info_speed,
    total: torrents.length,
    counts,
    torrents: list.slice(0, 8),
  };
}

// ---------- Sonarr / Radarr ----------
function queueSummary(q) {
  const records = q.records || [];
  return {
    total: q.totalRecords ?? records.length,
    items: records.slice(0, 5).map((r) => ({
      title: r.title,
      progress: r.size ? 1 - r.sizeleft / r.size : 0,
      status: r.trackedDownloadState || r.status,
      timeleft: r.timeleft || null,
    })),
  };
}

function dayRange(days) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return [start, new Date(start.getTime() + days * 864e5)];
}

async function sonarr(w) {
  const h = { 'X-Api-Key': w.apiKey };
  const [start, end] = dayRange(14);
  const [calendar, queue] = await Promise.all([
    getJson(join(w.url, `/api/v3/calendar?start=${start.toISOString()}&end=${end.toISOString()}&includeSeries=true`), h),
    getJson(join(w.url, '/api/v3/queue?pageSize=20'), h),
  ]);
  return {
    upcoming: calendar.slice(0, 10).map((e) => ({
      title: e.series?.title || 'Série inconnue',
      subtitle: `S${pad(e.seasonNumber)}E${pad(e.episodeNumber)}${e.title ? ' · ' + e.title : ''}`,
      date: e.airDateUtc,
      hasFile: !!e.hasFile,
    })),
    queue: queueSummary(queue),
  };
}

async function radarr(w) {
  const h = { 'X-Api-Key': w.apiKey };
  const [start, end] = dayRange(30);
  const [calendar, queue] = await Promise.all([
    getJson(join(w.url, `/api/v3/calendar?start=${start.toISOString()}&end=${end.toISOString()}`), h),
    getJson(join(w.url, '/api/v3/queue?pageSize=20'), h),
  ]);
  const upcoming = calendar.map((m) => {
    // Un film a plusieurs dates de sortie : on garde la plus proche dans la période.
    const [kind, date] = [['Cinéma', m.inCinemas], ['Numérique', m.digitalRelease], ['Physique', m.physicalRelease]]
      .filter(([, d]) => d && new Date(d) >= start && new Date(d) <= end)
      .sort((a, b) => new Date(a[1]) - new Date(b[1]))[0] || ['', m.inCinemas];
    return { title: m.title, subtitle: [m.year, kind].filter(Boolean).join(' · '), date, hasFile: !!m.hasFile };
  });
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { upcoming: upcoming.slice(0, 10), queue: queueSummary(queue) };
}

const INTEGRATIONS = {
  jellyfin: { fields: ['url', 'apiKey'], fetch: jellyfin },
  plex: { fields: ['url', 'apiKey'], fetch: plex },
  qbittorrent: { fields: ['url', 'username', 'password'], fetch: qbittorrent },
  sonarr: { fields: ['url', 'apiKey'], fetch: sonarr },
  radarr: { fields: ['url', 'apiKey'], fetch: radarr },
};

// Petit cache pour ne pas solliciter les services à chaque visiteur.
const cache = new Map();
const CACHE_MS = 4000;

async function fetchWidget(w) {
  const integration = INTEGRATIONS[w.type];
  if (!integration) throw new Error(`Type inconnu : ${w.type}`);
  const hit = cache.get(w.id);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.promise;
  const promise = integration.fetch(w);
  cache.set(w.id, { t: Date.now(), promise });
  promise.catch(() => cache.delete(w.id));
  return promise;
}

// À appeler quand la config change (URL ou identifiants modifiés).
function resetIntegrations() {
  cache.clear();
  qbitSids.clear();
}

module.exports = { INTEGRATIONS, fetchWidget, resetIntegrations, request };
