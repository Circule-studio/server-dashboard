// Intégrations : récupère et normalise les données des services (Jellyfin, Plex, qBittorrent, Sonarr, Radarr, météo, GitHub, NPM…).

const http = require('http');
const https = require('https');
const crypto = require('crypto');

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

// Taille maximale d'une réponse : au-delà, la requête est abandonnée. Sans limite, une URL
// pointant par erreur vers un gros fichier faisait planter tout le dashboard (chaîne trop longue).
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

// `discardBody` : on ne lit que le code HTTP (utile pour un simple ping).
// `raw` : corps renvoyé tel quel dans `body` (Buffer), pour une image.
// `verifyTls` : vérifier le certificat. Désactivé par défaut : les services du réseau local ont
// souvent un certificat auto-signé. À activer pour un service public qui reçoit un secret.
// `timeout` : inactivité maximale ; `deadline` : durée totale maximale. Le `timeout` de Node
// ne mesure que l'inactivité : un service qui envoie un octet de temps en temps le contournait.
function request(url, {
  method = 'GET', headers = {}, body, timeout = 8000, deadline = 20_000, maxBytes = MAX_RESPONSE_BYTES, discardBody = false,
  verifyTls = false, raw = false,
} = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(fail('invalid_url', 'URL invalide', { url })); }
    let done = false;
    let timer;
    // Une seule issue par requête, même si plusieurs événements arrivent ensuite (erreur après abandon…).
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers, timeout, rejectUnauthorized: verifyTls }, (res) => {
      res.on('error', (e) => finish(reject, networkError(e)));
      if (discardBody) {
        res.destroy();
        return finish(resolve, { status: res.statusCode, headers: res.headers });
      }
      const chunks = [];
      let size = 0;
      res.on('data', (d) => {
        size += d.length;
        if (size > maxBytes) {
          finish(reject, fail('response_too_large', 'Réponse trop volumineuse (vérifie l\'URL)', { max: Math.round(maxBytes / 1048576) }));
          req.destroy();
          return;
        }
        chunks.push(d);
      });
      res.on('end', () => {
        if (done) return;
        if (raw) return finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
        // Décodage en une fois : un caractère accentué coupé entre deux morceaux reste correct.
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* pas du JSON */ }
        finish(resolve, { status: res.statusCode, headers: res.headers, text, json });
      });
    });
    const expire = () => req.destroy(Object.assign(new Error('Délai dépassé'), { code: 'ETIMEDOUT' }));
    timer = setTimeout(expire, deadline);
    req.on('timeout', expire);
    req.on('error', (e) => finish(reject, networkError(e)));
    if (body) req.write(body);
    req.end();
  });
}

const join = (base, p) => base.replace(/\/+$/, '') + p;
const pad = (n) => String(n ?? 0).padStart(2, '0');

// `forbidden` : code d'erreur plus précis pour un 403 (clé valide mais droits insuffisants).
async function getJson(url, headers = {}, { forbidden } = {}) {
  const r = await request(url, { headers: { Accept: 'application/json', ...headers } });
  if (r.status === 403 && forbidden) throw fail(forbidden, 'Droits insuffisants');
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
  // Point ou virgule décimale (« 47.21, -1.55 » comme « 47,21 ; -1,55 »).
  const coords = location.match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (coords) {
    const [latitude, longitude] = [coords[1], coords[2]].map((v) => Number(v.replace(',', '.')));
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw fail('location_not_found', `Lieu introuvable : ${location}`, { location });
    return { name: '', latitude, longitude };
  }
  const key = `${w.url}|${location}`;
  if (places.has(key)) return places.get(key);
  // Sans résultat, l'API omet le tableau `results` (et non un tableau vide).
  const search = `/v1/search?count=1&name=${encodeURIComponent(location)}`;
  let found;
  try {
    found = await getJson(join(w.url || OPEN_METEO_GEOCODING, search));
  } catch (e) {
    // Une instance Open-Meteo auto-hébergée ne fait que les prévisions : le géocodage est un
    // service à part (open-meteo/geocoding-api). Sans lui (404), on cherche sur le service public.
    if (!w.url || e.key !== 'http' || e.params?.status !== 404) throw e;
    found = await getJson(join(OPEN_METEO_GEOCODING, search));
  }
  const { results } = found;
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

// ---------- Immich ----------
// Clé API d'un compte administrateur : la route est réservée aux admins et une clé
// limitée doit avoir la permission server.statistics (sinon HTTP 403).
async function immich(w) {
  const s = await getJson(join(w.url, '/api/server/statistics'), { 'x-api-key': w.apiKey }, { forbidden: 'immich_admin' });
  return {
    photos: s.photos, videos: s.videos, usage: s.usage,
    users: (s.usageByUser || [])
      .map((u) => ({ name: u.userName, photos: u.photos, videos: u.videos, usage: u.usage, quota: u.quotaSizeInBytes ?? null }))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 8),
  };
}

// ---------- Bloqueurs DNS : Pi-hole v6 et AdGuard Home ----------
// Format commun : protection (enabled / disabled / failed / unknown), minuteur (s),
// requêtes, bloquées, pourcentage, plus quelques compteurs propres au service.

// Pi-hole limite le nombre de sessions ouvertes (« API seats ») : on garde la
// session tant qu'elle est valide au lieu de se reconnecter à chaque appel.
// La promesse de connexion est mémorisée : deux appels simultanés ne consomment qu'une session.
const piholeSids = new Map(); // id du widget -> { url, sid: Promise<SID> } (SID '' : Pi-hole sans mot de passe)

async function piholeLogin(w) {
  const body = JSON.stringify({ password: w.password || '' });
  const r = await request(join(w.url, '/api/auth'), {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  const session = r.json?.session;
  if (r.status === 200 && session?.valid) return session.sid || '';
  // 2FA activée : seul un mot de passe d'application évite le code TOTP.
  if (r.status === 400 && /2FA|totp/i.test(r.json?.error?.message || '')) throw fail('pihole_totp', 'Pi-hole demande un code 2FA');
  if (r.status === 429) throw fail('pihole_seats', 'Pi-hole refuse une nouvelle session (trop de sessions ou de tentatives)');
  if (r.status === 401 || session) throw fail('pihole_password', 'Mot de passe Pi-hole refusé');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
}

async function piholeGet(w, path, retry = true) {
  if (!piholeSids.has(w.id)) {
    const entry = { url: w.url, sid: piholeLogin(w) };
    entry.sid.catch(() => { if (piholeSids.get(w.id) === entry) piholeSids.delete(w.id); });
    piholeSids.set(w.id, entry);
  }
  const sid = await piholeSids.get(w.id).sid;
  const r = await request(join(w.url, path), { headers: { Accept: 'application/json', ...(sid ? { 'X-FTL-SID': sid } : {}) } });
  if (r.status === 401 && retry) { // session expirée (30 min sans activité par défaut)
    piholeSids.delete(w.id);
    return piholeGet(w, path, false);
  }
  if (r.status === 401 || r.status === 403) throw fail('pihole_password', 'Mot de passe Pi-hole refusé');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

async function pihole(w) {
  // Séquentiel : la première requête ouvre la session, la seconde la réutilise.
  const s = await piholeGet(w, '/api/stats/summary');
  const b = await piholeGet(w, '/api/dns/blocking');
  return {
    protection: b.blocking || 'unknown',
    timer: b.timer ?? null,
    queries: s.queries?.total ?? 0,
    blocked: s.queries?.blocked ?? 0,
    percent: s.queries?.percent_blocked ?? 0,
    extra: [
      { key: 'blocklist', value: s.gravity?.domains_being_blocked ?? null },
      { key: 'clients', value: s.clients?.active ?? null },
    ],
  };
}

// AdGuard Home : authentification HTTP Basic (facultative si l'interface n'a pas de mot de passe).
async function adguard(w) {
  const h = w.username || w.password
    ? { Authorization: 'Basic ' + Buffer.from(`${w.username || ''}:${w.password || ''}`).toString('base64') }
    : {};
  const [stats, status] = await Promise.all([
    getJson(join(w.url, '/control/stats'), h),
    getJson(join(w.url, '/control/status'), h),
  ]).catch((e) => {
    // Pas de clé API ici : un refus vient de l'utilisateur ou du mot de passe.
    throw e.key === 'auth_refused' ? fail('adguard_credentials', 'Identifiants AdGuard Home refusés') : e;
  });
  const queries = stats.num_dns_queries || 0;
  // Bloquées = filtres + navigation sécurisée + contrôle parental (comme le tableau de bord d'AdGuard).
  const blocked = (stats.num_blocked_filtering || 0) + (stats.num_replaced_safebrowsing || 0) + (stats.num_replaced_parental || 0);
  return {
    protection: !status.running ? 'failed' : status.protection_enabled ? 'enabled' : 'disabled',
    timer: status.protection_disabled_duration ? status.protection_disabled_duration / 1000 : null,
    queries,
    blocked,
    percent: queries ? (blocked / queries) * 100 : 0,
    extra: [{ key: 'avgTime', value: stats.avg_processing_time ?? null }],
  };
}

// ---------- Frigate (caméras et détection d'objets) ----------
// Port 5000 : API sans authentification (réseau interne). Port 8971 (Frigate 0.14+) : connexion
// avec utilisateur et mot de passe, dont le jeton (cookie frigate_token) est gardé et réutilisé.
const frigateTokens = new Map(); // id du widget -> Promise<cookie> ('' sans authentification)

async function frigateLogin(w) {
  if (!w.username) return '';
  const body = JSON.stringify({ user: w.username, password: w.password || '' });
  const r = await request(join(w.url, '/api/login'), {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  const cookie = (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('frigate_token='));
  if (r.status === 200 && cookie) return cookie;
  if (r.status === 401 || r.status === 400) throw fail('frigate_credentials', 'Identifiants Frigate refusés');
  if (r.status === 429) throw fail('frigate_rate_limit', 'Frigate refuse les connexions (trop de tentatives)');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)'); // ex. port 5000, sans page de connexion
}

// `raw` : réponse binaire (miniature), sinon JSON.
async function frigateGet(w, path, { raw = false, retry = true } = {}) {
  if (!frigateTokens.has(w.id)) {
    const login = frigateLogin(w);
    login.catch(() => { if (frigateTokens.get(w.id) === login) frigateTokens.delete(w.id); });
    frigateTokens.set(w.id, login);
  }
  const cookie = await frigateTokens.get(w.id);
  const r = await request(join(w.url, path), {
    raw, maxBytes: raw ? 2 * 1024 * 1024 : undefined, headers: { Accept: raw ? 'image/*' : 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  });
  if (r.status === 401 && retry && cookie) { // jeton expiré (24 h par défaut)
    frigateTokens.delete(w.id);
    return frigateGet(w, path, { raw, retry: false });
  }
  if (r.status === 401 || r.status === 403) {
    if (w.username) throw fail('frigate_credentials', 'Identifiants Frigate refusés');
    throw fail('frigate_auth_required', 'Frigate demande une connexion');
  }
  if (r.status === 404 && raw) return null;
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (raw) return r;
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

async function frigate(w) {
  // Séquentiel : la première requête obtient le jeton, la seconde le réutilise.
  const stats = await frigateGet(w, '/api/stats');
  const events = await frigateGet(w, '/api/events?limit=6&include_thumbnails=0');
  // Frigate 0.14+ range les caméras dans stats.cameras ; avant, elles étaient à la racine.
  const cams = stats.cameras || Object.fromEntries(Object.entries(stats).filter(([, v]) => v && typeof v === 'object' && 'camera_fps' in v));
  const inference = Object.values(stats.detectors || {}).map((d) => d.inference_speed).filter((v) => typeof v === 'number');
  return {
    version: stats.service?.version || null,
    inference: inference.length ? Math.min(...inference) : null,
    cameras: Object.entries(cams).map(([name, c]) => ({
      name, online: (c.camera_fps || 0) > 0, fps: c.camera_fps ?? 0, detectionFps: c.detection_fps ?? 0,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    events: (Array.isArray(events) ? events : []).map((e) => ({
      id: String(e.id),
      camera: e.camera,
      // sub_label : nom reconnu (visage, plaque), texte ou [nom, score] selon la version.
      label: (Array.isArray(e.sub_label) ? e.sub_label[0] : e.sub_label) || e.label,
      object: e.label,
      score: e.data?.top_score ?? e.top_score ?? null,
      start: e.start_time ? new Date(e.start_time * 1000).toISOString() : null,
      ongoing: !e.end_time,
    })),
  };
}

// Miniature d'un événement, servie par le dashboard (jamais d'accès direct du navigateur à Frigate).
async function frigateThumbnail(w, eventId) {
  if (!/^[\w.-]{1,100}$/.test(eventId)) return null;
  const r = await frigateGet(w, `/api/events/${eventId}/thumbnail.jpg`, { raw: true });
  const type = r?.headers['content-type'] || '';
  return r && /^image\/(jpeg|png|webp)$/.test(type.split(';')[0]) ? { type: type.split(';')[0], body: r.body } : null;
}

// ---------- Home Assistant ----------
// Jeton d'accès longue durée (Profil > Sécurité). Une requête par entité choisie, en parallèle :
// bien plus léger que /api/states, qui renvoie toutes les entités de la maison (souvent des milliers).
async function homeassistant(w) {
  const headers = { Authorization: `Bearer ${w.apiKey}`, Accept: 'application/json' };
  const entities = await Promise.all((w.entities || []).map(async (id) => {
    const r = await request(join(w.url, `/api/states/${encodeURIComponent(id)}`), { headers });
    if (r.status === 401 || r.status === 403) throw fail('auth_refused', 'Authentification refusée (vérifie la clé API)');
    if (r.status === 404) return { id, missing: true }; // entité renommée ou supprimée : les autres restent affichées
    if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
    if (!r.json?.entity_id) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
    const a = r.json.attributes || {};
    return {
      id,
      name: a.friendly_name || id,
      state: r.json.state,
      unit: a.unit_of_measurement || '',
      deviceClass: a.device_class || '',
      changed: r.json.last_changed || null,
    };
  }));
  return { entities };
}

// ---------- Nginx Proxy Manager ----------
// `username` : e-mail du compte, `password` : son mot de passe. POST /api/tokens donne un jeton
// (valable 1 jour par défaut) : gardé et réutilisé, renouvelé avant expiration ou après un refus.
const npmTokens = new Map(); // id du widget -> { token: Promise<{ token, expires }> }
const NPM_SOON_DAYS = 14; // un certificat qui expire avant est mis en évidence

async function npmLogin(w) {
  const body = JSON.stringify({ identity: w.username || '', secret: w.password || '' });
  const r = await request(join(w.url, '/api/tokens'), {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  // Gardé au moins 10 min : avec des horloges décalées, un jeton neuf semblerait déjà expiré et on se
  // reconnecterait à chaque requête. S'il est vraiment expiré, NPM répond 401 et npmGet se reconnecte.
  if (r.status === 200 && r.json?.token) {
    return { token: r.json.token, expires: Math.max(Date.parse(r.json.expires) || 0, Date.now() + 10 * 60_000) };
  }
  if (r.status >= 400 && r.status < 500) throw fail('npm_credentials', 'Identifiants Nginx Proxy Manager refusés');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
}

async function npmGet(w, path, retry = true) {
  const known = npmTokens.get(w.id);
  // Renouvelé 5 min avant l'expiration ; la promesse est partagée par les appels simultanés.
  if (!known || (await known.token.catch(() => ({ expires: 0 }))).expires - Date.now() < 5 * 60_000) {
    const entry = { token: npmLogin(w) };
    entry.token.catch(() => { if (npmTokens.get(w.id) === entry) npmTokens.delete(w.id); });
    npmTokens.set(w.id, entry);
  }
  const { token } = await npmTokens.get(w.id).token;
  const r = await request(join(w.url, path), { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  if (r.status === 401 && retry) { // jeton révoqué (mot de passe changé, redémarrage…)
    npmTokens.delete(w.id);
    return npmGet(w, path, false);
  }
  if (r.status === 401 || r.status === 403) throw fail('npm_credentials', 'Identifiants Nginx Proxy Manager refusés');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (!Array.isArray(r.json)) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

// Dates de NPM : « 2026-12-01 10:00:00 » en UTC, sans fuseau.
const npmDate = (v) => (typeof v === 'string' ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(' ', 'T')}Z`) : NaN);

async function nginxProxyManager(w) {
  // Séquentiel : la première requête obtient le jeton, la seconde le réutilise.
  const hosts = await npmGet(w, '/api/nginx/proxy-hosts');
  const certificates = await npmGet(w, '/api/nginx/certificates');
  const now = Date.now();
  const certs = certificates.map((c) => {
    const expires = npmDate(c.expires_on);
    return {
      name: c.nice_name || c.domain_names?.[0] || `#${c.id}`,
      domains: (c.domain_names || []).length,
      provider: c.provider === 'letsencrypt' ? 'letsencrypt' : 'other',
      expires: Number.isNaN(expires) ? null : new Date(expires).toISOString(),
      expired: expires <= now,
      // Jours entamés : 4,2 jours restants s'affichent « dans 5 jours ».
      days: Number.isNaN(expires) ? null : Math.ceil((expires - now) / 864e5),
    };
  }).sort((a, b) => (a.expires ?? '9').localeCompare(b.expires ?? '9'));
  const enabled = hosts.filter((x) => x.enabled === true || x.enabled === 1).length;
  return {
    hosts: { enabled, disabled: hosts.length - enabled },
    soonDays: NPM_SOON_DAYS,
    expiring: certs.filter((c) => c.expired || (c.days != null && c.days <= NPM_SOON_DAYS)).length,
    certificates: certs.slice(0, 8),
    certificateCount: certs.length,
  };
}

// ---------- GitHub ----------
// `repo` : propriétaire/dépôt (normalisé par server.js). Jeton facultatif : obligatoire pour un
// dépôt privé, il relève aussi la limite de GitHub (60 requêtes par heure et par IP sans jeton).
// `url` : facultative, API d'un GitHub Enterprise (https://github.exemple.fr/api/v3) ou faux service.
const GITHUB_API = 'https://api.github.com';

// Lien affiché dans l'interface : seulement une adresse web (pas de javascript: venant de l'API).
const webUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

// Pour ménager la limite de GitHub :
// - chaque réponse est gardée avec son ETag et redemandée avec If-None-Match : une réponse
//   « 304 inchangé » ne compte pas dans la limite quand un jeton est utilisé ;
// - une réponse de moins de GITHUB_SHARE_MS est réutilisée telle quelle : deux widgets sur le
//   même dépôt (un bloc Version, un bloc Issues) ne font pas deux fois les mêmes requêtes ;
// - une fois la limite atteinte, plus aucune requête jusqu'à l'heure de reprise annoncée par GitHub.
// Ces mémoires ne dépendent que du jeton et de l'adresse : elles survivent aux changements de config
// (sinon chaque enregistrement coûterait une requête complète par widget) et sont purgées par âge.
const GITHUB_SHARE_MS = 60_000;
const GITHUB_KEEP_MS = 2 * 3600_000;
const githubResponses = new Map(); // `${jeton}|${url}` -> { t, etag, status, json, pending }
const githubLimits = new Map(); // `${jeton}|${API}|${core ou search}` -> heure de reprise (ms)
let githubPruned = 0;

function githubPrune() {
  const now = Date.now();
  if (now - githubPruned < 10 * 60_000) return;
  githubPruned = now;
  for (const [k, e] of githubResponses) if (!e.pending && now - e.t > GITHUB_KEEP_MS) githubResponses.delete(k);
  for (const [k, until] of githubLimits) if (until < now) githubLimits.delete(k);
  for (const [k, e] of githubLast) if (now - e.t > GITHUB_KEEP_MS) githubLast.delete(k);
  if (githubCompares.size > 500) githubCompares.clear();
}

const githubIdentity = (w) => (w.apiKey ? crypto.createHash('sha256').update(w.apiKey).digest('hex').slice(0, 16) : 'anonyme');

function githubLimited(until) {
  return fail('github_rate_limit', 'Limite de requêtes GitHub atteinte', { minutes: Math.max(1, Math.ceil((until - Date.now()) / 60_000)) });
}

// Heure de reprise si la réponse signale une limite, sinon null. Limite secondaire (trop de requêtes
// rapprochées) : retry-after prime sur x-ratelimit-reset, qui est la fin de la fenêtre d'une heure.
function githubLimitUntil(r) {
  if (r.status !== 403 && r.status !== 429) return null;
  const retryAfter = Number(r.headers['retry-after']);
  if (retryAfter > 0) return Date.now() + retryAfter * 1000;
  if (r.headers['x-ratelimit-remaining'] === '0') return Number(r.headers['x-ratelimit-reset']) * 1000 || Date.now() + 60_000;
  // Limite secondaire sans en-tête : GitHub conseille d'attendre au moins une minute.
  if (/rate limit/i.test(r.json?.message || '')) return Date.now() + 60_000;
  return null;
}

async function githubFetch(w, url, limitKey, known, maxBytes) {
  const reset = githubLimits.get(limitKey);
  if (reset > Date.now()) throw githubLimited(reset);
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'server-dashboard' };
  if (w.apiKey) headers.Authorization = `Bearer ${w.apiKey}`;
  if (known?.etag) headers['If-None-Match'] = known.etag;
  // Certificat vérifié pour github.com : le jeton ne doit partir que vers le vrai GitHub. Une URL
  // personnalisée (GitHub Enterprise interne) garde le comportement des autres services.
  const r = await request(url, { headers, maxBytes, verifyTls: !w.url });
  const until = githubLimitUntil(r);
  if (until) {
    githubLimits.set(limitKey, until);
    throw githubLimited(until);
  }
  if (r.status === 304 && known) return { status: known.status, json: known.json, etag: known.etag };
  return { status: r.status, json: r.json, etag: (r.status === 200 && r.headers.etag) || null };
}

// `optional` : codes HTTP qui veulent dire « rien à afficher » (ex. 409 pour un dépôt vide) -> null.
// `store: false` : réponse ni gardée ni partagée (déjà mémorisée ailleurs, ou volumineuse).
async function githubGet(w, path, { optional = [], store = true, maxBytes } = {}) {
  githubPrune();
  const api = w.url || GITHUB_API;
  const url = join(api, path);
  const id = githubIdentity(w);
  const limitKey = `${id}|${api}|${path.startsWith('/search/') ? 'search' : 'core'}`;
  let r;
  if (!store) {
    r = await githubFetch(w, url, limitKey, null, maxBytes);
  } else {
    const key = `${id}|${url}`;
    let entry = githubResponses.get(key);
    if (!entry?.pending && !(entry && Date.now() - entry.t < GITHUB_SHARE_MS)) {
      const pending = githubFetch(w, url, limitKey, entry, maxBytes);
      entry = { ...entry, pending };
      githubResponses.set(key, entry);
      try {
        entry = { t: Date.now(), ...(await pending) };
        githubResponses.set(key, entry);
      } catch (e) {
        githubResponses.set(key, { ...entry, pending: null, t: 0 });
        throw e;
      }
    }
    r = entry.pending ? await entry.pending : entry;
  }
  if (optional.includes(r.status)) return null;
  if (r.status === 401) throw fail('github_token', 'Jeton GitHub refusé');
  // GitHub répond 404 aussi pour un dépôt privé quand le jeton manque ou n'y a pas accès.
  if (r.status === 404) throw fail('github_not_found', `Dépôt GitHub introuvable : ${w.repo}`, { repo: w.repo });
  if (r.status === 403) throw fail('github_forbidden', 'Accès refusé par GitHub');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

// Commits entre une version et un commit : ne change jamais, calculé une seule fois.
const githubCompares = new Map(); // `${API}|${dépôt}|${tag}|${sha}` -> nombre de commits (ou null)

async function githubUnreleased(w, tag, sha) {
  const key = `${w.url || GITHUB_API}|${w.repo}|${tag}|${sha}`;
  if (!githubCompares.has(key)) {
    let ahead = null;
    try {
      // La réponse contient aussi la liste des fichiers modifiés : elle peut être lourde quand la
      // version est ancienne. Trop lourde ou trop lente : le nombre reste inconnu, sans erreur.
      const cmp = await githubGet(w, `/repos/${w.repo}/compare/${encodeURIComponent(tag)}...${sha}?per_page=1`,
        { optional: [404, 422], store: false, maxBytes: 4 * 1024 * 1024 });
      ahead = cmp?.ahead_by ?? null;
    } catch (e) {
      if (e.key !== 'response_too_large' && e.key !== 'timeout') throw e;
    }
    githubCompares.set(key, ahead);
  }
  return githubCompares.get(key);
}

// Tags triés par numéro de version : l'API les trie par nom (v1.9.0 avant v1.10.0).
const byVersion = (a, b) => b.localeCompare(a, 'en', { numeric: true });

async function githubVersion(w, repo) {
  const base = `/repos/${w.repo}`;
  const [releases, commits] = await Promise.all([
    githubGet(w, `${base}/releases?per_page=6`),
    githubGet(w, `${base}/commits?per_page=1&sha=${encodeURIComponent(repo.branch)}`, { optional: [404, 409] }), // 409 : dépôt vide
  ]);
  let list = releases.filter((r) => !r.draft).map((r) => ({
    tag: r.tag_name, name: r.name || r.tag_name, date: r.published_at || r.created_at, prerelease: !!r.prerelease, url: webUrl(r.html_url),
  }));
  // Pas de release : on se rabat sur les tags (sans date dans cette route).
  if (!list.length) {
    const tags = (await githubGet(w, `${base}/tags?per_page=100`, { optional: [404, 409] })) || [];
    list = tags.map((tg) => tg.name).sort(byVersion).slice(0, 5).map((tag) => ({
      tag, name: tag, date: null, prerelease: false,
      url: repo.url && `${repo.url}/releases/tag/${encodeURIComponent(tag)}`,
    }));
  }
  // Comme GitHub, la « dernière version » est la plus récente qui n'est pas une pré-release.
  const latest = list.find((r) => !r.prerelease) || list[0] || null;
  const at = list.indexOf(latest);
  const c = commits?.[0];
  return {
    latest,
    unreleased: latest && c ? await githubUnreleased(w, latest.tag, c.sha) : null,
    // Pré-release plus récente que la dernière version (ex. une bêta en cours), et versions précédentes.
    prerelease: at > 0 ? list[0] : null,
    previous: list.slice(at + 1, at + 5),
    branch: repo.branch,
    commit: c ? {
      sha: c.sha.slice(0, 7),
      message: (c.commit?.message || '').split('\n')[0],
      author: c.author?.login || c.commit?.author?.name || '',
      date: c.commit?.committer?.date || c.commit?.author?.date,
      url: webUrl(c.html_url),
    } : null,
  };
}

// Recherche plutôt que /issues : le nombre est exact et ne mélange pas issues et PR, en une requête.
async function githubSearch(w, kind) {
  const q = encodeURIComponent(`repo:${w.repo} is:${kind} is:open`);
  const r = await githubGet(w, `/search/issues?q=${q}&sort=created&order=desc&per_page=5`);
  return {
    total: r.total_count ?? 0,
    items: (r.items || []).map((i) => ({
      number: i.number,
      title: i.title,
      url: webUrl(i.html_url),
      author: i.user?.login || '',
      date: i.created_at,
      draft: !!i.draft,
      // Couleur validée : elle finit dans un attribut style.
      labels: (i.labels || []).slice(0, 3).map((l) => ({ name: l.name, color: /^[0-9a-f]{6}$/i.test(l.color) ? l.color : null })),
    })),
  };
}

async function githubRepoInfo(w) {
  const repo = await githubGet(w, `/repos/${w.repo}`);
  return {
    name: repo.full_name, url: webUrl(repo.html_url), branch: repo.default_branch,
    stars: repo.stargazers_count ?? 0, forks: repo.forks_count ?? 0,
    private: !!repo.private, archived: !!repo.archived, pushed: repo.pushed_at,
  };
}

// Dernières données complètes reçues par widget. Quand la limite est atteinte, chaque partie
// concernée (infos du dépôt, version, issues, PR) reprend ses dernières données, avec un
// avertissement ; les autres restent à jour (la recherche a sa propre limite, par exemple).
const githubLast = new Map(); // id du widget -> { sig, t, data }

async function github(w) {
  if (!w.repo) throw fail('github_repo_invalid', 'Dépôt manquant', { repo: '' });
  const sections = w.sections?.length ? w.sections : INTEGRATIONS.github.sections;
  const sig = JSON.stringify([w.url, w.repo, sections, githubIdentity(w)]);
  const prev = githubLast.get(w.id)?.sig === sig ? githubLast.get(w.id) : null;
  let limited = null;
  const part = (name, promise) => promise.catch((e) => {
    if (e.key !== 'github_rate_limit' || !prev?.data[name]) throw e;
    limited = e;
    return prev.data[name];
  });
  const out = { sections, repo: await part('repo', githubRepoInfo(w)) };
  // Seuls les blocs choisis sont demandés : ça ménage la limite de requêtes.
  await Promise.all([
    sections.includes('version') && part('version', githubVersion(w, out.repo)).then((v) => { out.version = v; }),
    sections.includes('issues') && part('issues', githubSearch(w, 'issue')).then((v) => { out.issues = v; }),
    sections.includes('pulls') && part('pulls', githubSearch(w, 'pr')).then((v) => { out.pulls = v; }),
  ]);
  if (!limited) githubLast.set(w.id, { sig, t: Date.now(), data: out });
  else out.limited = { since: new Date(prev.t).toISOString(), minutes: limited.params.minutes };
  return out;
}

const INTEGRATIONS = {
  // `cacheMs` : durée pendant laquelle les données sont partagées entre visiteurs (défaut : CACHE_MS).
  // Une fonction permet d'adapter la durée au widget.
  weather: { fields: ['location', 'url'], cacheMs: 10 * 60_000, fetch: weather },
  // Sans jeton, 60 requêtes par heure : un widget en fait 4 à 5 à chaque rafraîchissement.
  github: {
    fields: ['repo', 'apiKey', 'url'], sections: ['version', 'issues', 'pulls'],
    cacheMs: (w) => (w.apiKey ? 2 * 60_000 : 15 * 60_000), fetch: github,
  },
  immich: { fields: ['url', 'apiKey'], cacheMs: 60_000, fetch: immich },
  npm: { fields: ['url', 'username', 'password'], cacheMs: 60_000, fetch: nginxProxyManager },
  homeassistant: { fields: ['url', 'apiKey', 'entities'], fetch: homeassistant },
  // `thumbnail` : images servies par /api/widgets/:id/thumbnail/:eventId (voir server.js).
  frigate: { fields: ['url', 'username', 'password'], cacheMs: 10_000, fetch: frigate, thumbnail: frigateThumbnail },
  pihole: { fields: ['url', 'password'], fetch: pihole },
  adguard: { fields: ['url', 'username', 'password'], fetch: adguard },
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
  const ttl = typeof integration.cacheMs === 'function' ? integration.cacheMs(w) : integration.cacheMs;
  if (hit && Date.now() - hit.t < (ttl || CACHE_MS)) return hit.promise;
  const promise = integration.fetch(w);
  cache.set(w.id, { t: Date.now(), promise });
  promise.catch(() => cache.delete(w.id));
  return promise;
}

// À appeler quand la config change (URL ou identifiants modifiés).
function resetIntegrations() {
  cache.clear();
  qbitSids.clear();
  npmTokens.clear();
  frigateTokens.clear();
  places.clear();
  // Ferme les sessions Pi-hole devenues inutiles pour libérer leurs places (sans attendre la réponse).
  for (const { url, sid } of piholeSids.values()) {
    sid.then((s) => s && request(join(url, '/api/auth'), { method: 'DELETE', headers: { 'X-FTL-SID': s }, discardBody: true }))
      .catch(() => {});
  }
  piholeSids.clear();
}

module.exports = { INTEGRATIONS, fetchWidget, resetIntegrations, request };
