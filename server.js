// Server Dashboard — backend Express
// API : config des tuiles, statut des services, stats système, Docker, auth admin.

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { INTEGRATIONS, fetchWidget, resetIntegrations, request } = require('./integrations');

// En local (npm start), lit le fichier .env s'il existe. Les variables déjà définies
// (Docker, systemd) restent prioritaires.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* pas de .env */ }

const PORT = Number(process.env.PORT) || 7575;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DISK_PATH = process.env.DISK_PATH || (process.platform === 'win32' ? 'C:\\' : '/');
const DOCKER_SOCKET = process.env.DOCKER_SOCKET ||
  (process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock');
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

async function readConfig() {
  let text;
  try {
    text = await fsp.readFile(CONFIG_FILE, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    await writeConfig(DEFAULT_CONFIG);
    return structuredClone(DEFAULT_CONFIG);
  }
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
  };
  const result = writeQueue.then(run, run);
  writeQueue = result.catch(() => {});
  return result;
}

// Erreur avec un code traduisible par l'interface (err.* dans public/i18n.js).
const fail = (key, message, params) => Object.assign(new Error(message), { key, params });

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const SECRET_FIELDS = ['apiKey', 'password'];

function checkUrl(url) {
  if (url && !/^https?:\/\//i.test(url)) throw fail('invalid_url', `URL invalide : ${url}`, { url });
  return url;
}

// Élément d'une liste de la config : un null, un nombre ou un tableau est refusé proprement
// (avant, l'erreur JavaScript brute était renvoyée au navigateur).
function item(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail('bad_request', 'Élément invalide dans la configuration');
  return v;
}

// Identifiant unique dans la liste : absent ou déjà vu, il est remplacé. Les données des
// widgets et le statut des apps sont rangés par identifiant : un doublon mélangeait les deux.
function uniqueId(seen, raw, prefix) {
  let id = str(raw, 64);
  if (!id || seen.has(id)) id = `${prefix}-${crypto.randomUUID()}`;
  seen.add(id);
  return id;
}

// `previous` sert à conserver les secrets : le navigateur ne les reçoit jamais,
// donc un champ vide signifie « inchangé ».
function sanitizeWidgets(list, previous = []) {
  const seen = new Set();
  const occurrences = new Map(); // identifiant reçu -> nombre de fois déjà vu
  return (Array.isArray(list) ? list : []).map(item).map((w) => {
    const type = str(w.type, 32);
    if (!INTEGRATIONS[type]) throw fail('bad_request', `Type de widget inconnu : ${type}`);
    const raw = str(w.id, 64);
    const id = uniqueId(seen, raw, 'wid');
    // Doublon venu d'un config.json modifié à la main : le n-ième garde les secrets du n-ième.
    const n = occurrences.get(raw) || 0;
    occurrences.set(raw, n + 1);
    const old = (raw && previous.filter((p) => p.id === raw)[n]) || {};
    const out = { id, type, name: str(w.name, 100) || type, url: checkUrl(str(w.url, 2000)) };
    // Le nom d'utilisateur n'est envoyé qu'aux admins : absent de la requête = inchangé.
    if (INTEGRATIONS[type].fields.includes('username')) {
      out.username = typeof w.username === 'string' ? str(w.username, 200) : old.username || '';
    }
    // Lieu de la météo : nom de ville ou coordonnées.
    if (INTEGRATIONS[type].fields.includes('location')) out.location = str(w.location, 200);
    // Blocs à afficher, pour les intégrations qui en proposent (ex. Pulse).
    const allowed = INTEGRATIONS[type].sections;
    if (allowed) {
      const chosen = (Array.isArray(w.sections) ? w.sections : []).filter((s) => allowed.includes(s));
      out.sections = chosen.length ? [...new Set(chosen)] : [...allowed];
    }
    for (const f of SECRET_FIELDS) {
      if (!INTEGRATIONS[type].fields.includes(f)) continue;
      // Vide = inchangé ; clearApiKey / clearPassword = effacer (ex. Pi-hole sans mot de passe).
      const clear = w[`clear${f[0].toUpperCase()}${f.slice(1)}`] === true;
      out[f] = clear ? '' : str(w[f], 500) || old[f] || '';
    }
    return out;
  });
}

// Version envoyée au navigateur : jamais de clés API ni de mots de passe,
// et les noms d'utilisateur seulement pour un admin connecté.
function publicConfig(cfg, authed) {
  return {
    ...cfg,
    widgets: cfg.widgets.map((w) => {
      const pub = { ...w };
      for (const f of SECRET_FIELDS) {
        if (f in pub) { pub['has' + f[0].toUpperCase() + f.slice(1)] = !!pub[f]; delete pub[f]; }
      }
      if (!authed) delete pub.username;
      return pub;
    }),
  };
}

// Éléments de la barre du haut que l'admin peut masquer (tous visibles par défaut).
const DISPLAY_OPTIONS = ['search', 'theme', 'lang'];

function sanitizeDisplay(display) {
  const src = display && typeof display === 'object' ? display : {};
  return Object.fromEntries(DISPLAY_OPTIONS.map((k) => [k, src[k] !== false]));
}

function sanitizeConfig(input, previous) {
  if (!input || !Array.isArray(input.categories)) throw fail('bad_request', 'categories manquant');
  const catIds = new Set();
  const appIds = new Set(); // uniques sur tout le tableau : /api/status les range par identifiant
  return {
    revision: (previous?.revision || 0) + 1,
    title: str(input.title, 100) || 'Mon serveur',
    // Absent de la requête (ancienne interface) = inchangé.
    display: sanitizeDisplay(input.display ?? previous?.display),
    widgets: sanitizeWidgets(input.widgets, previous?.widgets),
    disks: (Array.isArray(input.disks) ? input.disks : []).slice(0, 20)
      .map((d) => ({ path: str(d?.path, 500), label: str(d?.label, 50) }))
      .filter((d) => d.path),
    categories: input.categories.map(item).map((c) => ({
      id: uniqueId(catIds, c.id, 'cat'),
      name: str(c.name, 100) || 'Sans nom',
      apps: (Array.isArray(c.apps) ? c.apps : []).map(item).map((a) => {
        return {
          id: uniqueId(appIds, a.id, 'app'),
          name: str(a.name, 100) || 'App',
          url: checkUrl(str(a.url, 2000)),
          icon: str(a.icon, 2000),
          description: str(a.description, 200),
        };
      }),
    })),
  };
}

// ---------- Auth (cookie signé HMAC) ----------
// La clé de signature dépend du mot de passe : le changer invalide toutes les sessions.
const SIGNING_KEY = crypto.createHmac('sha256', SECRET).update(ADMIN_PASSWORD).digest();
// Sessions fermées par « Déconnexion » (id -> expiration), gardées jusqu'à leur expiration.
// Enregistrées sur disque : sans cela, un redémarrage rendait valides les cookies déconnectés.
const REVOKED_FILE = path.join(DATA_DIR, '.revoked-sessions.json');

function loadRevoked() {
  try {
    const saved = JSON.parse(fs.readFileSync(REVOKED_FILE, 'utf8'));
    return Object.entries(saved).filter(([id, exp]) => typeof id === 'string' && Number(exp) > Date.now());
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[!] ${REVOKED_FILE} illisible, ignoré : ${e.message}`);
    return [];
  }
}

const revokedSessions = new Map(loadRevoked());

// Écriture synchrone et atomique : rare (déconnexion, nettoyage) et doit survivre à un arrêt brutal.
function saveRevoked() {
  const tmp = `${REVOKED_FILE}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(revokedSessions)), { mode: 0o600 });
    fs.renameSync(tmp, REVOKED_FILE);
  } catch (e) {
    console.error(`[!] Impossible d'enregistrer les sessions fermées : ${e.message}`);
    try { fs.unlinkSync(tmp); } catch { /* déjà absent */ }
  }
}

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

// ---------- Ping des services ----------
async function ping(url, timeout = 5000) {
  const start = Date.now();
  try {
    const { status } = await request(url, { timeout, discardBody: true });
    // Un 401/403 signifie que le service répond : on le considère en ligne.
    return { online: status < 500, code: status, ms: Date.now() - start };
  } catch (e) {
    return { online: false, error: e.message, errorCode: e.key, ms: Date.now() - start };
  }
}

// Statuts partagés entre tous les visiteurs pendant STATUS_CACHE_MS.
let statusCache = null; // { t, promise }

async function computeStatuses() {
  const cfg = await readConfig();
  const apps = cfg.categories.flatMap((c) => c.apps).filter((a) => a.url);
  const results = await Promise.all(apps.map(async (a) => [a.id, await ping(a.url)]));
  return Object.fromEntries(results);
}

function getStatuses() {
  if (!statusCache || Date.now() - statusCache.t > STATUS_CACHE_MS) {
    const entry = { t: Date.now(), promise: computeStatuses() };
    entry.promise.catch(() => { if (statusCache === entry) statusCache = null; });
    statusCache = entry;
  }
  return statusCache.promise;
}

// ---------- Stats système ----------
let lastCpu = os.cpus();

function cpuUsage() {
  const now = os.cpus();
  let idle = 0, total = 0;
  now.forEach((c, i) => {
    const prev = lastCpu[i] ? lastCpu[i].times : { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const t = c.times;
    idle += t.idle - prev.idle;
    total += (t.user - prev.user) + (t.nice - prev.nice) + (t.sys - prev.sys) + (t.idle - prev.idle) + (t.irq - prev.irq);
  });
  lastCpu = now;
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

async function memInfo() {
  // Sous Linux, MemAvailable est plus juste que os.freemem() (qui ignore le cache).
  if (process.platform === 'linux') {
    try {
      const txt = await fsp.readFile('/proc/meminfo', 'utf8');
      const get = (k) => Number((txt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1]) * 1024;
      const total = get('MemTotal'), avail = get('MemAvailable');
      if (total && avail) return { total, used: total - avail };
    } catch { /* repli sur os */ }
  }
  return { total: os.totalmem(), used: os.totalmem() - os.freemem() };
}

// ---------- Disques ----------
// Systèmes de fichiers « réels » sous Linux (on ignore proc, tmpfs, overlay, cgroup…).
const LINUX_FS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'f2fs', 'jfs', 'ntfs', 'ntfs3', 'fuseblk',
  'vfat', 'exfat', 'nfs', 'nfs4', 'cifs', 'smb3', 'fuse.mergerfs', 'fuse.shfs']);
const SKIP_MOUNTS = /^\/(proc|sys|dev|run|snap|boot\/efi|var\/lib\/docker)(\/|$)/;

async function statDisk(diskPath) {
  const s = await fsp.statfs(diskPath);
  const total = s.blocks * s.bsize;
  return { total, used: total - s.bavail * s.bsize };
}

async function diskInfo(d) {
  try {
    return { ...d, ...(await statDisk(d.path)) };
  } catch (e) {
    return { ...d, error: e.code === 'ENOENT' ? 'Chemin introuvable' : e.message, errorCode: e.code === 'ENOENT' ? 'path_not_found' : undefined };
  }
}

// Disques affichés : ceux choisis en mode édition, sinon DISK_PATH.
const disksOf = (cfg) => (cfg.disks?.length ? cfg.disks : [{ path: DISK_PATH, label: '' }]);

// Disques présents sur la machine, proposés dans le mode édition.
async function detectDisks() {
  if (process.platform === 'win32') {
    const found = [];
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const diskPath = `${letter}:\\`;
      try { found.push({ path: diskPath, ...(await statDisk(diskPath)) }); } catch { /* lecteur absent */ }
    }
    return found.filter((d) => d.total > 0);
  }
  let mounts;
  try {
    mounts = await fsp.readFile('/proc/mounts', 'utf8');
  } catch {
    return [await diskInfo({ path: '/' })];
  }
  // Un même périphérique peut être monté plusieurs fois : on garde DISK_PATH, sinon le chemin le plus court.
  const byDevice = new Map();
  for (const line of mounts.split('\n')) {
    const [device, rawPath, type] = line.split(' ');
    if (!rawPath || !LINUX_FS.has(type)) continue;
    const diskPath = rawPath.replace(/\\040/g, ' ');
    if (SKIP_MOUNTS.test(diskPath)) continue;
    const prev = byDevice.get(device);
    if (prev && (prev.path === DISK_PATH || (diskPath !== DISK_PATH && prev.path.length <= diskPath.length))) continue;
    byDevice.set(device, { path: diskPath, type });
  }
  const found = await Promise.all([...byDevice.values()].map(diskInfo));
  return found.filter((d) => !d.error && d.total > 0).sort((a, b) => a.path.localeCompare(b.path));
}

// ---------- Docker (API Engine via socket unix / named pipe) ----------
// Comme request() dans integrations.js : taille et durée totale bornées, une seule issue.
const DOCKER_MAX_BYTES = 20 * 1024 * 1024;

function docker(method, apiPath) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const req = http.request({ socketPath: DOCKER_SOCKET, path: apiPath, method, timeout: 5000 }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('error', (e) => finish(reject, e));
      res.on('data', (d) => {
        size += d.length;
        if (size > DOCKER_MAX_BYTES) {
          finish(reject, new Error('Docker : réponse trop volumineuse'));
          req.destroy();
          return;
        }
        chunks.push(d);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) return finish(reject, new Error(`Docker ${res.statusCode}: ${body.slice(0, 500)}`));
        let data = null;
        try { data = body ? JSON.parse(body) : null; } catch { /* pas du JSON */ }
        finish(resolve, data);
      });
    });
    timer = setTimeout(() => req.destroy(new Error('timeout')), 15_000);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => finish(reject, e));
    req.end();
  });
}

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
// Derrière un reverse proxy, indiquer TRUST_PROXY (ex. 1) pour obtenir la vraie IP des visiteurs.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Express 4 ne capture pas les erreurs des handlers async : on les renvoie à next().
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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

app.get('/api/config', readAuth, route(async (req, res) => {
  res.json(publicConfig(await readConfig(), isAuthed(req)));
}));

app.put('/api/config', requireAuth, route(async (req, res) => withConfigLock(async () => {
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
  resetIntegrations();
  statusCache = null;
  res.json(publicConfig(cfg, true));
})));

app.get('/api/widgets/:id', readAuth, route(async (req, res) => {
  const cfg = await readConfig();
  const widget = cfg.widgets.find((w) => w.id === req.params.id);
  if (!widget) return res.status(404).json({ error: 'Widget introuvable', code: 'not_found' });
  try {
    res.json(await fetchWidget(widget));
  } catch (e) {
    res.status(502).json({ error: e.message || 'Erreur inconnue', code: e.key, params: e.params });
  }
}));

app.get('/api/status', readAuth, route(async (req, res) => res.json(await getStatuses())));

app.get('/api/system', readAuth, route(async (req, res) => {
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
}));

app.get('/api/disks', requireAuth, route(async (req, res) => res.json(await detectDisks())));

app.get('/api/docker/containers', readAuth, route(async (req, res) => {
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
}));

app.post('/api/docker/containers/:id/:action', requireAuth, route(async (req, res) => {
  const { id, action } = req.params;
  if (!/^[a-f0-9]{12,64}$/.test(id) || !['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ error: 'Requête invalide', code: 'bad_request' });
  }
  try {
    await docker('POST', `/containers/${id}/${action}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

// Dernier filet : toute erreur non gérée devient une réponse JSON au lieu de faire tomber le serveur.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[${req.method} ${req.path}]`, err);
  res.status(status).json(status >= 500
    ? { error: err.message || 'Erreur serveur', code: err.key || 'server', params: err.params }
    : { error: 'Requête invalide', code: 'bad_request' });
});

app.listen(PORT, () => console.log(`Server Dashboard sur http://localhost:${PORT}`));
