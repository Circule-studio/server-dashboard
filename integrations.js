// Intégrations : récupère et normalise les données des services (Jellyfin, Plex, qBittorrent, Sonarr, Radarr, météo…).

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

// Erreur avec un code traduisible par l'interface (`key`, voir err.* dans public/i18n.js).
function fail(key, message, params) {
  return Object.assign(new Error(message), { key, params });
}

const NETWORK_KEYS = {
  ECONNREFUSED: 'unreachable', ENOTFOUND: 'host_not_found', EHOSTUNREACH: 'host_unreachable',
  ECONNRESET: 'connection_reset', ETIMEDOUT: 'timeout',
};

function networkError(e) {
  return fail(NETWORK_KEYS[e.code], NETWORK_ERRORS[e.code] || e.message || e.code || 'Erreur réseau');
}

// `discardBody` : on ne lit que le code HTTP (utile pour un simple ping).
function request(url, { method = 'GET', headers = {}, body, timeout = 8000, discardBody = false } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(fail('invalid_url', 'URL invalide', { url })); }
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
  if (r.status === 401 || r.status === 403) throw fail('auth_refused', 'Authentification refusée (vérifie la clé API)');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
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
      { key: 'movies', value: counts.MovieCount },
      { key: 'series', value: counts.SeriesCount },
      { key: 'episodes', value: counts.EpisodeCount },
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
      { key: 'libraries', value: dirs.length },
      { key: 'streams', value: items.length },
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
  if (r.status === 403) throw fail('qbit_banned', 'IP bannie par qBittorrent (trop de tentatives)');
  const sid = (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('SID='));
  if (sid) return sid;
  if (r.text.trim() === 'Ok.') return ''; // authentification contournée (réseau local autorisé)
  throw fail('qbit_credentials', 'Identifiants qBittorrent refusés');
}

async function qbitGet(w, path, retry = true) {
  if (!qbitSids.has(w.id)) qbitSids.set(w.id, await qbitLogin(w));
  const r = await request(join(w.url, path), { headers: { Cookie: qbitSids.get(w.id), Referer: w.url } });
  if (r.status === 403 && retry) {
    qbitSids.delete(w.id);
    return qbitGet(w, path, false);
  }
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
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
      title: e.series?.title || null, // null : l'interface affiche « Série inconnue »
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
    const [kind, date] = [['cinema', m.inCinemas], ['digital', m.digitalRelease], ['physical', m.physicalRelease]]
      .filter(([, d]) => d && new Date(d) >= start && new Date(d) <= end)
      .sort((a, b) => new Date(a[1]) - new Date(b[1]))[0] || ['', m.inCinemas];
    return { title: m.title, year: m.year, release: kind, date, hasFile: !!m.hasFile };
  });
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { upcoming: upcoming.slice(0, 10), queue: queueSummary(queue) };
}

// ---------- Proxmox VE ----------
// Un jeton d'API en lecture seule suffit (rôle PVEAuditor). `username` = identifiant du
// jeton (ex. root@pam!dashboard), `apiKey` = son secret.
async function proxmox(w) {
  const { data } = await getJson(join(w.url, '/api2/json/cluster/resources'), {
    Authorization: `PVEAPIToken=${w.username}=${w.apiKey}`,
  });
  const pct = (used, total) => (total ? used / total : 0);
  const nodes = data.filter((r) => r.type === 'node').map((n) => ({
    name: n.node,
    online: n.status === 'online',
    cpu: n.cpu || 0,
    cores: n.maxcpu,
    mem: n.mem, maxmem: n.maxmem,
    disk: n.disk, maxdisk: n.maxdisk,
    uptime: n.uptime,
  }));
  const guests = data.filter((r) => (r.type === 'qemu' || r.type === 'lxc') && !r.template).map((g) => ({
    id: g.vmid,
    name: g.name || `${g.type}-${g.vmid}`,
    type: g.type === 'qemu' ? 'VM' : 'LXC',
    running: g.status === 'running',
    node: g.node,
    cpu: g.cpu || 0,
    mem: pct(g.mem, g.maxmem),
  })).sort((a, b) => b.running - a.running || a.id - b.id);
  const storages = data.filter((r) => r.type === 'storage' && r.status === 'available' && r.maxdisk).map((s) => ({
    name: s.storage, node: s.node, used: s.disk, total: s.maxdisk,
  }));
  return { nodes, guests, storages, running: guests.filter((g) => g.running).length };
}

// ---------- Pulse (supervision Proxmox, Docker…) ----------
// Jeton d'API Pulse avec le scope monitoring:read. On n'interroge que les
// endpoints des blocs choisis dans le widget (`sections`).

async function pulse(w) {
  const h = { 'X-API-Token': w.apiKey };
  const sections = w.sections?.length ? w.sections : ['health', 'alerts', 'resources'];
  const out = { sections };
  const tasks = [];

  if (sections.includes('health')) {
    tasks.push(getJson(join(w.url, '/api/state/summary'), h).then((s) => {
      out.health = {
        verdicts: s.verdicts || {},
        counts: { nodes: s.nodes || 0, vms: s.vms || 0, containers: s.containers || 0, docker: (s.dockerHosts || []).length },
        activeAlerts: s.activeAlerts || 0,
        attention: (s.attention || []).slice(0, 6).map((a) => ({
          name: a.name, verdict: a.verdict, reason: a.topReason?.code || '', type: a.type,
        })),
      };
    }));
  }

  if (sections.includes('alerts')) {
    tasks.push(getJson(join(w.url, '/api/alerts/active'), h).then((list) => {
      const order = { critical: 0, warning: 1, info: 2 };
      out.alerts = (Array.isArray(list) ? list : [])
        .map((a) => ({
          level: a.level, resource: a.resourceName || a.resourceId,
          text: a.summary || a.message, since: a.startTime, acknowledged: !!a.acknowledged,
        }))
        .sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3) || new Date(b.since) - new Date(a.since))
        .slice(0, 15);
    }));
  }

  if (sections.includes('resources')) {
    tasks.push(getJson(join(w.url, '/api/resources?type=agent,vm,system-container&limit=100&sort=name'), h).then((r) => {
      const rank = { agent: 0, vm: 1, 'system-container': 2 };
      // Une mesure absente n'est pas 0 % : on la laisse à null (voir la doc de l'API Pulse).
      const pct = (m) => (m ? (m.percent || m.value || 0) : null);
      out.resources = (r.data || [])
        .map((x) => ({
          type: x.type, rank: rank[x.type] ?? 3, name: x.name, status: x.status,
          verdict: x.health?.verdict, parent: x.parentName || '',
          cpu: pct(x.metrics?.cpu), mem: pct(x.metrics?.memory),
        }))
        .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
        .slice(0, 40);
    }));
  }

  await Promise.all(tasks);
  return out;
}

// ---------- Météo (Open-Meteo, sans clé API) ----------
// `location` : un nom de ville, géocodé une seule fois, ou des coordonnées « 47.21, -1.55 ».
// `url` : facultative, pour une instance Open-Meteo auto-hébergée (ou les faux services).
const OPEN_METEO = 'https://api.open-meteo.com';
const OPEN_METEO_GEOCODING = 'https://geocoding-api.open-meteo.com';
const places = new Map(); // `${url}|${location}` -> lieu géocodé

async function weatherPlace(w) {
  const location = (w.location || '').trim();
  if (!location) throw fail('location_missing', 'Lieu manquant');
  const coords = location.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (coords) {
    const [latitude, longitude] = [Number(coords[1]), Number(coords[2])];
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw fail('location_not_found', `Lieu introuvable : ${location}`, { location });
    return { name: '', latitude, longitude };
  }
  const key = `${w.url}|${location}`;
  if (places.has(key)) return places.get(key);
  // Sans résultat, l'API omet le tableau `results` (et non un tableau vide).
  const { results } = await getJson(join(w.url || OPEN_METEO_GEOCODING, `/v1/search?count=1&name=${encodeURIComponent(location)}`));
  const p = results?.[0];
  if (!p) throw fail('location_not_found', `Lieu introuvable : ${location}`, { location });
  const place = { name: p.name, region: p.admin1 || '', country: p.country_code || '', latitude: p.latitude, longitude: p.longitude };
  places.set(key, place);
  return place;
}

async function weather(w) {
  const place = await weatherPlace(w);
  const q = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: 5,
  });
  const d = await getJson(join(w.url || OPEN_METEO, `/v1/forecast?${q}`));
  const c = d.current || {};
  const daily = d.daily || {};
  return {
    place,
    units: { temp: d.current_units?.temperature_2m || '°C', wind: d.current_units?.wind_speed_10m || 'km/h' },
    current: {
      temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code,
      wind: c.wind_speed_10m, day: c.is_day !== 0,
    },
    // Dates locales du lieu (AAAA-MM-JJ), grâce à timezone=auto.
    days: (daily.time || []).map((date, i) => ({
      date,
      code: daily.weather_code?.[i],
      max: daily.temperature_2m_max?.[i],
      min: daily.temperature_2m_min?.[i],
      rain: daily.precipitation_probability_max?.[i] ?? null,
    })),
  };
}

const INTEGRATIONS = {
  // `cacheMs` : durée pendant laquelle les données sont partagées entre visiteurs (défaut : CACHE_MS).
  weather: { fields: ['location', 'url'], cacheMs: 10 * 60_000, fetch: weather },
  proxmox: { fields: ['url', 'username', 'apiKey'], fetch: proxmox },
  pulse: { fields: ['url', 'apiKey'], sections: ['health', 'alerts', 'resources'], fetch: pulse },
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
  if (hit && Date.now() - hit.t < (integration.cacheMs || CACHE_MS)) return hit.promise;
  const promise = integration.fetch(w);
  cache.set(w.id, { t: Date.now(), promise });
  promise.catch(() => cache.delete(w.id));
  return promise;
}

// À appeler quand la config change (URL ou identifiants modifiés).
function resetIntegrations() {
  cache.clear();
  qbitSids.clear();
  places.clear();
}

module.exports = { INTEGRATIONS, fetchWidget, resetIntegrations, request };
