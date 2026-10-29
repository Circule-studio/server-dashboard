// qBittorrent.

const { request, fail, join, sessionCache } = require('./lib');

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

const qbitSessions = sessionCache(qbitLogin); // cookie SID ('' si l'auth est désactivée)

async function qbitGet(w, path, retry = true) {
  const sid = await qbitSessions.get(w);
  const r = await request(join(w.url, path), { headers: { Cookie: sid, Referer: w.url } });
  if (r.status === 403 && retry) {
    qbitSessions.drop(w);
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

module.exports = {
  qbittorrent: { fields: ['url', 'username', 'password'], fetch: qbittorrent, reset: () => qbitSessions.clear() },
};
