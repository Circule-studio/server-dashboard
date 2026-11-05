// Server Dashboard — backend Express
// API : config des tuiles, statut des services, stats système, Docker, auth admin.

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { version: APP_VERSION } = require('./package.json');
const { INTEGRATIONS, fetchWidget, refreshWidget, resetIntegrations, request, orStale } = require('./integrations');
const { fail, readJsonFile, writeJsonFileSync } = require('./integrations/lib');
const { SECRET_FIELDS, sanitizeConfig, sanitizeNotify, publicConfig } = require('./config');
const { cpuUsage, memInfo, diskInfo, disksOf, detectDisks, docker, dockerUsage } = require('./system');
const { sendNotification, createMonitor } = require('./notify');
const { checkApp } = require('./checks');

// En local (npm start), lit le fichier .env s'il existe. Les variables déjà définies
// (Docker, systemd) restent prioritaires.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* pas de .env */ }

const PORT = Number(process.env.PORT) || 7575;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
// true : tout le dashboard (lecture comprise) exige d'être connecté.
const REQUIRE_LOGIN = process.env.REQUIRE_LOGIN === 'true';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const COOKIE_NAME = 'sd_session';
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const STATUS_CACHE_MS = 15_000;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Secret de session (persisté pour survivre aux redémarrages) ----------
const SECRET_FILE = path.join(DATA_DIR, '.secret');
const SECRET = process.env.SESSION_SECRET || (() => {
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  return s;
})();

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[!] ADMIN_PASSWORD non défini : mot de passe par défaut "admin". Change-le en production.');
}

// ---------- Config ----------
// Première installation : config vide, l'interface affiche un écran d'accueil.
const DEFAULT_CONFIG = {
  // Présent dès le départ : le contrôle « modifiée ailleurs » marche aussi au tout premier enregistrement.
  revision: 0,
  title: 'Mon serveur',
  widgets: [],
  categories: [],
};

// Config gardée en mémoire : avant, chaque requête (stats toutes les 5 s, chaque widget…) relisait
// et analysait le fichier. On ne le relit que si sa date ou sa taille a changé (modification à la
// main). L'objet renvoyé est partagé : ne jamais le modifier, sanitizeConfig() en crée un nouveau.
let configCache = null; // { stamp, cfg }

// Empreinte du fichier : date de modification et de changement d'état, taille, inode (un éditeur
// qui réécrit le fichier par renommage change l'inode même dans la même seconde).
const stampOf = (stat) => `${stat.mtimeMs}|${stat.ctimeMs}|${stat.size}|${stat.ino}`;

async function readConfig() {
  let stat;
  try {
    stat = await fsp.stat(CONFIG_FILE);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const cfg = structuredClone(DEFAULT_CONFIG);
    await writeConfig(cfg);
    return cfg;
  }
  if (configCache?.stamp === stampOf(stat)) return configCache.cfg;
  const text = await fsp.readFile(CONFIG_FILE, 'utf8');
  // Un fichier invalide n'est jamais écrasé : on préfère une erreur à une perte de config.
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch (e) {
    throw fail('config_invalid', `data/config.json est invalide (${e.message}). Corrige le fichier : il n'a pas été modifié.`, { detail: e.message });
  }
  cfg.widgets ||= [];
  cfg.categories ||= [];
  cfg.revision = Number.isInteger(cfg.revision) ? cfg.revision : 0;
  // Modifié à la main : URL ou identifiants ont pu changer, comme après un enregistrement.
  if (configCache) invalidateCaches();
  configCache = { stamp: stampOf(stat), cfg };
  return cfg;
}

// Une seule modification de config à la fois (lecture, contrôle de version, écriture).
let configLock = Promise.resolve();

function withConfigLock(fn) {
  const result = configLock.then(fn, fn);
  configLock = result.catch(() => {});
  return result;
}

// Écritures sérialisées avec un fichier temporaire unique : deux écritures
// simultanées ne peuvent pas se marcher dessus.
let writeQueue = Promise.resolve();

function writeConfig(cfg) {
  const run = async () => {
    const tmp = `${CONFIG_FILE}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2));
    await fsp.rename(tmp, CONFIG_FILE);
    configCache = { stamp: stampOf(await fsp.stat(CONFIG_FILE)), cfg };
  };
  const result = writeQueue.then(run, run);
  writeQueue = result.catch(() => {});
  return result;
}


// ---------- Auth (cookie signé HMAC) ----------
// La clé de signature dépend du mot de passe : le changer invalide toutes les sessions.
const SIGNING_KEY = crypto.createHmac('sha256', SECRET).update(ADMIN_PASSWORD).digest();
// Sessions fermées par « Déconnexion » (id -> expiration), gardées jusqu'à leur expiration.
// Enregistrées sur disque : sans cela, un redémarrage rendait valides les cookies déconnectés.
const REVOKED_FILE = path.join(DATA_DIR, '.revoked-sessions.json');

const revokedSessions = new Map(Object.entries(readJsonFile(REVOKED_FILE) || {})
  .filter(([, exp]) => Number(exp) > Date.now()));

// Écriture synchrone : rare (déconnexion, nettoyage) et doit survivre à un arrêt brutal.
const saveRevoked = () => writeJsonFileSync(REVOKED_FILE, Object.fromEntries(revokedSessions));

function sign(value) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(value).digest('hex');
}

function makeToken() {
  const payload = `${Date.now() + SESSION_TTL_MS}.${crypto.randomBytes(12).toString('hex')}`;
  return `${payload}.${sign(payload)}`;
}

function parseToken(token) {
  const [exp, id, sig] = (token || '').split('.');
  if (!exp || !id || !sig || Number(exp) < Date.now() || revokedSessions.has(id)) return null;
  const expected = Buffer.from(sign(`${exp}.${id}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return { exp: Number(exp), id };
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const isAuthed = (req) => !!parseToken(getCookie(req, COOKIE_NAME));

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Non authentifié', code: 'auth_required' });
}

// Routes de lecture : publiques, sauf si REQUIRE_LOGIN=true.
const readAuth = REQUIRE_LOGIN ? requireAuth : (req, res, next) => next();

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- Limitation des tentatives de connexion (par IP) ----------
const loginFailures = new Map(); // ip -> { count, reset }

function loginRetryAfter(ip) {
  const entry = loginFailures.get(ip);
  if (!entry) return 0;
  if (Date.now() > entry.reset) { loginFailures.delete(ip); return 0; }
  return entry.count >= LOGIN_MAX_FAILS ? entry.reset - Date.now() : 0;
}

function recordLoginFailure(ip) {
  const entry = loginFailures.get(ip);
  if (entry && Date.now() <= entry.reset) entry.count++;
  else loginFailures.set(ip, { count: 1, reset: Date.now() + LOGIN_WINDOW_MS });
}

// Nettoyage périodique des entrées expirées (échecs et sessions révoquées).
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of loginFailures) if (now > e.reset) loginFailures.delete(ip);
  let pruned = false;
  for (const [id, exp] of revokedSessions) if (now > exp) { revokedSessions.delete(id); pruned = true; }
  if (pruned) saveRevoked();
}, 10 * 60 * 1000).unref();

// ---------- Statut des services ----------
// Vérification de chaque tuile : son adresse, une autre adresse, un ping ou rien (checks.js).

// Statuts partagés entre tous les visiteurs pendant STATUS_CACHE_MS.
let statusCache = null; // { t, promise }
let linksCache = null; // tuiles liées : { t, promise } (voir getLinks)

// Config changée (enregistrée ou modifiée à la main) : URL ou identifiants ont pu changer.
function invalidateCaches() {
  resetIntegrations();
  statusCache = null;
  linksCache = null;
}

async function computeStatuses() {
  const cfg = await readConfig();
  const apps = cfg.categories.flatMap((c) => c.apps);
  const results = await Promise.all(apps.map(async (a) => [a.id, await checkApp(a)]));
  // Tuile sans vérification (« aucune ») : pas de statut, ni pastille ni notification.
  return Object.fromEntries(results.filter(([, s]) => s));
}

// `maxAge` : âge maximal des statuts partagés (plus court pour la vérification des notifications).
// `stale` : pendant un recalcul, renvoyer vite les derniers statuts connus plutôt que d'attendre
// l'application la plus lente (jusqu'à 5 s). Les notifications attendent les statuts frais.
function getStatuses(maxAge = STATUS_CACHE_MS, { stale = false } = {}) {
  const previous = statusCache;
  if (!statusCache || Date.now() - statusCache.t > maxAge) {
    const entry = { t: Date.now(), promise: computeStatuses(), last: previous?.value ?? previous?.last };
    entry.promise.then((value) => { entry.value = value; entry.last = null; }, () => { if (statusCache === entry) statusCache = null; });
    statusCache = entry;
  }
  if (stale && !statusCache.value && statusCache.last) return orStale(statusCache.promise, statusCache.last);
  return statusCache.promise;
}


// ---------- App ----------
const app = express();
app.disable('x-powered-by');
// Derrière un reverse proxy, indiquer TRUST_PROXY (ex. 1) pour obtenir la vraie IP des visiteurs.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
// Relevés des agents : petits, et reçus de machines hors de la session admin (64 Ko au plus).
const jsonBody = express.json({ limit: '1mb' });
const agentBody = express.json({ limit: '64kb' });
app.use((req, res, next) => (req.path.startsWith('/api/agent/') ? agentBody : jsonBody)(req, res, next));
app.use(express.static(path.join(__dirname, 'public')));

// Réponses d'erreur. `e.key` est le code traduit par l'interface (err.* dans public/i18n.js).
const sendError = (res, status, e) => res.status(status).json({ error: e.message || 'Erreur inconnue', code: e.key, params: e.params });
const notFound = (res) => res.status(404).json({ error: 'Introuvable', code: 'not_found' });
const findWidget = (cfg, id) => cfg.widgets.find((w) => w.id === id);

app.get('/api/me', (req, res) => {
  const authenticated = isAuthed(req);
  res.json({
    authenticated,
    loginRequired: REQUIRE_LOGIN,
    // Révélé seulement à un admin connecté : inutile d'indiquer aux visiteurs
    // que le mot de passe par défaut fonctionne.
    defaultPassword: authenticated && ADMIN_PASSWORD === 'admin',
  });
});

app.post('/api/login', (req, res) => {
  const retryAfter = loginRetryAfter(req.ip);
  if (retryAfter) {
    res.setHeader('Retry-After', Math.ceil(retryAfter / 1000));
    const minutes = Math.ceil(retryAfter / 60000);
    return res.status(429).json({ error: `Trop de tentatives. Réessaie dans ${minutes} min.`, code: 'too_many_attempts', params: { minutes } });
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    recordLoginFailure(req.ip);
    return res.status(401).json({ error: 'Mot de passe incorrect', code: 'bad_password' });
  }
  loginFailures.delete(req.ip);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const session = parseToken(getCookie(req, COOKIE_NAME));
  if (session) {
    revokedSessions.set(session.id, session.exp);
    saveRevoked();
  }
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/config', readAuth, async (req, res) => {
  res.json(publicConfig(await readConfig(), isAuthed(req)));
});

// Export de la config (mode édition > Sauvegarde), admin seulement. Sans ?secrets=1, les clés API
// et mots de passe sont retirés : le fichier peut être partagé. L'import se fait dans le navigateur,
// puis passe par PUT /api/config comme un enregistrement normal.
const EXPORT_FORMAT = 'server-dashboard-config';

app.get('/api/config/export', requireAuth, async (req, res) => {
  const { revision, ...cfg } = await readConfig();
  const secrets = req.query.secrets === '1';
  const config = secrets ? cfg : {
    ...cfg,
    notify: cfg.notify && { type: cfg.notify.type, lang: cfg.notify.lang },
    widgets: cfg.widgets.map((w) => Object.fromEntries(Object.entries(w).filter(([k]) => !SECRET_FIELDS.includes(k)))),
  };
  const date = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Disposition': `attachment; filename="server-dashboard-${date}${secrets ? '-avec-secrets' : ''}.json"`,
    'Cache-Control': 'no-store',
  });
  res.json({ format: EXPORT_FORMAT, version: APP_VERSION, exportedAt: new Date().toISOString(), secrets, config });
});

app.put('/api/config', requireAuth, async (req, res) => withConfigLock(async () => {
  const previous = await readConfig();
  // Verrouillage optimiste : on refuse d'écraser une config modifiée depuis que le
  // navigateur l'a chargée (autre onglet, autre appareil). Sans `revision`
  // (anciens clients, scripts), l'enregistrement reste accepté.
  if (req.body?.revision !== undefined && req.body.revision !== previous.revision) {
    return res.status(409).json({
      error: 'La configuration a été modifiée ailleurs (autre onglet ou appareil) depuis que tu l’as ouverte.',
      code: 'conflict',
    });
  }
  let cfg;
  try {
    cfg = sanitizeConfig(req.body, previous);
  } catch (e) {
    // Seules nos erreurs prévues (avec un code) sont détaillées ; les autres restent dans les logs.
    if (!e.key) console.error('[PUT /api/config]', e);
    return res.status(400).json(e.key
      ? { error: e.message, code: e.key, params: e.params }
      : { error: 'Requête invalide', code: 'bad_request' });
  }
  await writeConfig(cfg);
  invalidateCaches();
  res.json(publicConfig(cfg, true));
}));

app.get('/api/widgets/:id', readAuth, async (req, res) => {
  const cfg = await readConfig();
  const widget = findWidget(cfg, req.params.id);
  if (!widget) return notFound(res);
  try {
    const data = await fetchWidget(widget, cfg.widgets);
    const { publicData } = INTEGRATIONS[widget.type];
    res.json(publicData && !isAuthed(req) ? publicData(data) : data);
  } catch (e) {
    sendError(res, 502, e);
  }
});

// Bouton ⟳ : admin seulement, pour qu'un visiteur ne puisse pas épuiser les limites d'un service.
const REFRESH_GAP_MS = 2000;
const lastRefresh = new Map(); // id du widget -> date

app.post('/api/widgets/:id/refresh', requireAuth, async (req, res) => {
  const cfg = await readConfig();
  const widget = findWidget(cfg, req.params.id);
  if (!widget) return notFound(res);
  if (Date.now() - (lastRefresh.get(widget.id) || 0) < REFRESH_GAP_MS) {
    return res.status(429).json({ error: 'Rafraîchi à l\'instant : réessaie dans un moment', code: 'refresh_too_soon' });
  }
  lastRefresh.set(widget.id, Date.now());
  try {
    res.json(await refreshWidget(widget, cfg.widgets));
  } catch (e) {
    sendError(res, 502, e);
  }
});

// Connexion d'un widget à un compte (Spotify). Le jeton obtenu est enregistré sans changer la révision de la
// config : un formulaire ouvert en même temps reste enregistrable, et son « vide = inchangé » garde le jeton.
async function oauthWidget(req, res) {
  const widget = findWidget(await readConfig(), req.params.id);
  const oauth = widget && INTEGRATIONS[widget.type].oauth;
  if (!oauth) notFound(res);
  return { widget, oauth };
}

app.get('/api/widgets/:id/oauth', requireAuth, async (req, res) => {
  const { widget, oauth } = await oauthWidget(req, res);
  if (!oauth) return;
  res.set('Cache-Control', 'no-store');
  res.json({ url: oauth.start(widget), redirectUri: oauth.redirectUri });
});

app.post('/api/widgets/:id/oauth', requireAuth, async (req, res) => {
  const { widget, oauth } = await oauthWidget(req, res);
  if (!oauth) return;
  let token;
  try {
    token = await oauth.finish(widget, String(req.body?.url || '').slice(0, 4000));
  } catch (e) {
    return sendError(res, 400, e);
  }
  await withConfigLock(async () => {
    const cfg = structuredClone(await readConfig());
    const w = findWidget(cfg, widget.id);
    if (!w) return;
    w.apiKey = token;
    w.authorizedAt = new Date().toISOString();
    await writeConfig(cfg);
  });
  resetIntegrations();
  res.json({ ok: true });
});

// Images d'un widget (miniatures des événements Frigate) : passent par le dashboard, avec les
// mêmes droits que ses données (REQUIRE_LOGIN), pour ne jamais exposer le service lui-même.
app.get('/api/widgets/:id/thumbnail/:key', readAuth, async (req, res) => {
  const cfg = await readConfig();
  const widget = findWidget(cfg, req.params.id);
  const thumbnail = widget && INTEGRATIONS[widget.type].thumbnail;
  if (!thumbnail) return notFound(res);
  let image;
  try {
    image = await thumbnail(widget, req.params.key);
  } catch (e) {
    return sendError(res, 502, e);
  }
  if (!image) return notFound(res);
  // Gardée par le navigateur (jamais par un proxy partagé). Événement en cours (?live) : Frigate
  // remplace la miniature quand il trouve une meilleure image, elle n'est donc gardée que 10 s.
  const maxAge = 'live' in req.query ? 10 : 86400;
  res.set({ 'Content-Type': image.type, 'Cache-Control': `private, max-age=${maxAge}`, 'X-Content-Type-Options': 'nosniff' });
  res.send(image.body);
});

// ---------- Agents (machines qui envoient elles-mêmes leurs ressources) ----------
// Authentifiés par le jeton de leur widget, pas par le cookie : REQUIRE_LOGIN ne s'applique pas.
const AGENT_SCRIPT = path.join(__dirname, 'agent', 'server-dashboard-agent.js');

function agentWidget(cfg, id) {
  const w = findWidget(cfg, id);
  return w && INTEGRATIONS[w.type]?.receive ? w : null;
}

// Le widget d'un envoi, après vérification de son jeton (sinon la réponse est déjà faite).
async function agentFromToken(req, res) {
  const w = agentWidget(await readConfig(), req.params.id);
  if (!w) {
    notFound(res);
    return null;
  }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!w.apiKey || !safeEqual(token, w.apiKey)) {
    res.status(401).json({ error: 'Jeton refusé', code: 'auth_refused' });
    return null;
  }
  return w;
}

// Demande ouverte de l'agent : le bouton ⟳ y répond tout de suite (voir integrations/agent.js).
app.get('/api/agent/:id/wait', async (req, res) => {
  const w = await agentFromToken(req, res);
  if (!w) return;
  if (!INTEGRATIONS[w.type].waitCommand) return notFound(res);
  const { promise, cancel } = INTEGRATIONS[w.type].waitCommand(w);
  req.on('close', cancel); // agent arrêté : la demande disparaît avec lui
  res.set('Cache-Control', 'no-store');
  res.json(await promise);
});

app.post('/api/agent/:id', async (req, res) => {
  const w = await agentFromToken(req, res);
  if (!w) return;
  if (!INTEGRATIONS[w.type].receive(w, req.body)) return res.status(429).json({ error: 'Trop d\'envois', code: 'too_many_attempts' });
  res.json({ ok: true });
});

// Identifiant et jeton de l'agent, pour sa commande d'installation : admin seulement. L'adresse du
// dashboard est celle du navigateur de l'admin (juste même derrière un reverse proxy HTTPS).
app.get('/api/agent/:id/setup', requireAuth, async (req, res) => {
  const w = agentWidget(await readConfig(), req.params.id);
  if (!w) return notFound(res);
  res.set('Cache-Control', 'no-store');
  res.json({ id: w.id, token: w.apiKey });
});

app.get('/agent/server-dashboard-agent.js', (req, res) => res.type('application/javascript').sendFile(AGENT_SCRIPT));
app.get('/agent/install.sh', (req, res) => res.type('text/plain').sendFile(path.join(__dirname, 'agent', 'install.sh')));

// Version du dashboard et dernière release publiée (#112). Réservé aux admins : afficher la version
// à tous aiderait à repérer une installation vulnérable. GitHub est interrogé au plus toutes les 12 h.
const UPDATE_CHECK = process.env.UPDATE_CHECK !== 'false';
const UPDATE_API = process.env.UPDATE_API || 'https://api.github.com';
const UPDATE_EVERY_MS = 12 * 3600_000;
const release = { t: 0, latest: null, url: null, pending: null };

async function latestRelease() {
  if (!UPDATE_CHECK) return release;
  if (Date.now() - release.t < UPDATE_EVERY_MS) return release;
  release.pending ||= request(`${UPDATE_API}/repos/circule-studio/server-dashboard/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, timeout: 5000 })
    .then((r) => {
      if (r.status === 200 && typeof r.json?.tag_name === 'string') {
        release.latest = r.json.tag_name.replace(/^v/, '');
        release.url = typeof r.json.html_url === 'string' ? r.json.html_url : null;
      }
    })
    .catch(() => {}) // hors ligne : la version installée reste affichée
    .finally(() => { release.t = Date.now(); release.pending = null; });
  await release.pending;
  return release;
}

// 0.20.0 < 0.21.0 < 1.0.0 ; une préversion (« -beta.1 ») n'est jamais proposée.
function isNewer(latest, current) {
  if (!latest || latest.includes('-')) return false;
  const a = latest.split('.').map(Number);
  const b = current.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

app.get('/api/version', requireAuth, async (req, res) => {
  const { latest, url } = await latestRelease();
  const update = isNewer(latest, APP_VERSION);
  res.json({ version: APP_VERSION, latest: update ? latest : null, url: update ? url : null });
});

app.get('/api/status', readAuth, async (req, res) => res.json(await getStatuses(STATUS_CACHE_MS, { stale: true })));

app.get('/api/system', readAuth, async (req, res) => {
  const disks = await Promise.all(disksOf(await readConfig()).map(diskInfo));
  res.json({
    hostname: process.env.SERVER_NAME || os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    uptime: os.uptime(),
    cpu: { usage: cpuUsage(), cores: os.cpus().length, model: os.cpus()[0]?.model, load: os.loadavg() },
    memory: await memInfo(),
    disks,
    disk: disks[0], // compatibilité avec les anciennes versions de l'interface
  });
});

app.get('/api/disks', requireAuth, async (req, res) => res.json(await detectDisks()));

// ---------- Tuiles liées à une VM / un LXC ou à un conteneur (#89) ----------
const LINKS_CACHE_MS = 10_000;


// { id d'app: { name, running, cpu, mem } | { missing: true } | { error: code } }
async function computeLinks() {
  const cfg = await readConfig();
  const apps = cfg.categories.flatMap((c) => c.apps).filter((a) => a.link);
  // Une seule lecture par widget Proxmox (même cache que le widget) et une pour Docker.
  const pve = {};
  for (const a of apps.filter((x) => x.link.type === 'proxmox')) {
    const w = findWidget(cfg, a.link.widget);
    pve[a.link.widget] ??= fetchWidget(w).catch((e) => ({ error: e.key || 'unreachable' }));
  }
  const names = apps.filter((a) => a.link.type === 'docker').map((a) => a.link.container);
  const containers = names.length ? dockerUsage(names).catch(() => null) : null;
  const out = {};
  for (const a of apps) {
    if (a.link.type === 'proxmox') {
      const d = await pve[a.link.widget];
      const g = d.guests?.find((x) => x.id === a.link.vmid);
      out[a.id] = d.error ? { error: d.error } : g
        ? { name: `${g.type} ${g.id} · ${g.name}`, running: g.running, cpu: g.cpu, mem: g.mem }
        : { missing: true };
    } else {
      const list = await containers;
      out[a.id] = !list ? { error: 'docker_unavailable' } : list[a.link.container] || { missing: true };
    }
  }
  return out;
}

function getLinks() {
  if (!linksCache || Date.now() - linksCache.t > LINKS_CACHE_MS) {
    const entry = { t: Date.now(), promise: computeLinks() };
    entry.promise.catch(() => { if (linksCache === entry) linksCache = null; });
    linksCache = entry;
  }
  return linksCache.promise;
}

app.get('/api/links', readAuth, async (req, res) => res.json(await getLinks()));

app.get('/api/docker/containers', readAuth, async (req, res) => {
  try {
    const list = await docker('GET', '/containers/json?all=1');
    res.json({
      available: true,
      containers: list.map((c) => ({
        id: c.Id.slice(0, 12),
        name: (c.Names[0] || '').replace(/^\//, ''),
        image: c.Image,
        state: c.State,
        status: c.Status,
      })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    res.json({ available: false, error: e.message });
  }
});

app.post('/api/docker/containers/:id/:action', requireAuth, async (req, res) => {
  const { id, action } = req.params;
  if (!/^[a-f0-9]{12,64}$/.test(id) || !['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ error: 'Requête invalide', code: 'bad_request' });
  }
  try {
    await docker('POST', `/containers/${id}/${action}`);
    res.json({ ok: true });
  } catch (e) {
    sendError(res, 502, e);
  }
});

// Dernier filet : toute erreur non gérée devient une réponse JSON au lieu de faire tomber le serveur.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[${req.method} ${req.path}]`, err);
  res.status(status).json(status >= 500
    ? { error: err.message || 'Erreur serveur', code: err.key || 'server', params: err.params }
    : { error: 'Requête invalide', code: 'bad_request' });
});

// ---------- Notifications : vérification des apps en tâche de fond ----------
// Toutes les NOTIFY_INTERVAL_MS, même sans visiteur, quand des notifications sont configurées.
// Le résultat sert aussi aux visiteurs (statusCache), pour ne pas pinguer deux fois.
const NOTIFY_INTERVAL_MS = Number(process.env.NOTIFY_INTERVAL_MS) || 60_000;
const monitor = createMonitor();
const widgetMonitor = createMonitor(); // éléments signalés par les widgets « M'alerter »
let monitoring = false;

// Éléments surveillés par les widgets dont « M'alerter » est coché. Un widget en erreur (mauvaise
// clé, service injoignable) ne donne rien, sauf les codes `offlineCodes` de son intégration, qui
// veulent dire « machine éteinte » (ex. Glances qui ne répond plus).
async function widgetAlertItems(cfg) {
  const lists = await Promise.all(cfg.widgets.filter((w) => w.alert && INTEGRATIONS[w.type]?.alerts).map(async (w) => {
    const integration = INTEGRATIONS[w.type];
    try {
      return integration.alerts(await fetchWidget(w), w);
    } catch (e) {
      return integration.offlineCodes?.includes(e.key) ? [{ id: `${w.id}:machine`, name: w.name, url: w.url, online: false }] : [];
    }
  }));
  return lists.flat();
}

async function checkForNotifications() {
  if (monitoring) return; // vérification précédente pas finie (services lents)
  monitoring = true;
  try {
    const cfg = await readConfig();
    if (!cfg.notify?.type) { monitor.clear(); widgetMonitor.clear(); return; } // réactivées plus tard : pas d'alerte sur l'état ancien
    // Statuts d'un visiteur réutilisés s'ils sont assez récents : pas de double ping.
    const [statuses, items] = await Promise.all([getStatuses(Math.min(STATUS_CACHE_MS, NOTIFY_INTERVAL_MS / 2)), widgetAlertItems(cfg)]);
    const events = [
      ...monitor.update(cfg.categories.flatMap((c) => c.apps).filter((a) => a.url), statuses).map((event) => [monitor, event]),
      ...widgetMonitor.update(items, Object.fromEntries(items.map((i) => [i.id, i]))).map((event) => [widgetMonitor, event]),
    ];
    // En parallèle : un service lent ne retarde pas les autres alertes ; un échec repart au tour suivant.
    await Promise.all(events.map(([source, event]) => sendNotification(cfg.notify, { ...event, board: cfg.title }).catch((e) => {
      source.failed(event);
      console.error(`[notifications] envoi impossible (${event.kind} ${event.name}) : ${e.message}`);
    })));
  } catch (e) {
    console.error('[notifications]', e.message);
  } finally {
    monitoring = false;
  }
}
setInterval(checkForNotifications, NOTIFY_INTERVAL_MS).unref();

// Bouton « Envoyer un test » : réglages du formulaire, même pas encore enregistrés (URL et jeton
// vides = ceux enregistrés).
app.post('/api/notify/test', requireAuth, async (req, res) => {
  const cfg = await readConfig();
  let notify;
  try {
    notify = sanitizeNotify(req.body || {}, cfg.notify);
    if (!notify.type) throw fail('notify_missing', 'Notifications non configurées');
  } catch (e) {
    return sendError(res, 400, { message: e.message, key: e.key || 'bad_request', params: e.params });
  }
  try {
    await sendNotification(notify, { kind: 'test', board: cfg.title });
  } catch (e) {
    return sendError(res, 502, e);
  }
  res.json({ ok: true });
});

// Express 5 passe l'erreur d'écoute (port déjà pris…) au rappel : sans ce contrôle, le dashboard
// annonçait démarrer puis s'arrêtait avec le code 0, que systemd (Restart=on-failure) ne relance pas.
app.listen(PORT, (err) => {
  if (err) {
    console.error(`[!] Impossible d'écouter sur le port ${PORT} : ${err.code === 'EADDRINUSE' ? 'déjà utilisé par un autre programme' : err.message}`);
    process.exit(1);
  }
  console.log(`Server Dashboard sur http://localhost:${PORT}`);
});
