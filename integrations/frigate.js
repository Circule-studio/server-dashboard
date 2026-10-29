// Frigate (caméras et détection d'objets).
// Port 5000 : API sans authentification (réseau interne). Port 8971 (Frigate 0.14+) : connexion
// avec utilisateur et mot de passe, dont le jeton (cookie frigate_token) est gardé et réutilisé.

const { request, fail, join, sessionCache } = require('./lib');

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
const frigateSessions = sessionCache(frigateLogin); // cookie frigate_token ('' sans authentification)

async function frigateGet(w, path, { raw = false, retry = true } = {}) {
  const cookie = await frigateSessions.get(w);
  const r = await request(join(w.url, path), {
    raw, maxBytes: raw ? 2 * 1024 * 1024 : undefined, headers: { Accept: raw ? 'image/*' : 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  });
  if (r.status === 401 && retry && cookie) { // jeton expiré (24 h par défaut)
    frigateSessions.drop(w);
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
  // En parallèle : la connexion est partagée (sessionCache), une seule a lieu.
  const [stats, events] = await Promise.all([
    frigateGet(w, '/api/stats'),
    frigateGet(w, '/api/events?limit=6&include_thumbnails=0'),
  ]);
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
  // Identifiants de Frigate : « 1730190000.123-abcd ». « . » ou « .. » changeraient le chemin demandé.
  if (!/^(?!\.+$)[\w.-]{1,100}$/.test(eventId)) return null;
  const r = await frigateGet(w, `/api/events/${encodeURIComponent(eventId)}/thumbnail.jpg`, { raw: true });
  const type = r?.headers['content-type'] || '';
  return r && /^image\/(jpeg|png|webp)$/.test(type.split(';')[0]) ? { type: type.split(';')[0], body: r.body } : null;
}

module.exports = {
  frigate: {
    fields: ['url', 'username', 'password'], cacheMs: 10_000, fetch: frigate, thumbnail: frigateThumbnail,
    reset: () => frigateSessions.clear(),
  },
};
