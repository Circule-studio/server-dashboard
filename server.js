// Server Dashboard — backend Express
// API : config des tuiles, statut des services, stats système, Docker, auth admin.

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { INTEGRATIONS, fetchWidget, resetIntegrations } = require('./integrations');

const PORT = Number(process.env.PORT) || 7575;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DISK_PATH = process.env.DISK_PATH || (process.platform === 'win32' ? 'C:\\' : '/');
const DOCKER_SOCKET = process.env.DOCKER_SOCKET ||
  (process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock');
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const COOKIE_NAME = 'sd_session';

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
const DEFAULT_CONFIG = {
  title: 'Mon serveur',
  widgets: [],
  categories: [
    {
      id: 'cat-media', name: 'Média', apps: [
        { id: 'app-jellyfin', name: 'Jellyfin', url: 'http://localhost:8096', icon: 'jellyfin', description: 'Films & séries' },
      ],
    },
    {
      id: 'cat-admin', name: 'Administration', apps: [
        { id: 'app-portainer', name: 'Portainer', url: 'http://localhost:9000', icon: 'portainer', description: 'Gestion Docker' },
        { id: 'app-google', name: 'Google', url: 'https://www.google.com', icon: 'google', description: 'Test de statut' },
      ],
    },
  ],
};

async function readConfig() {
  try {
    const cfg = JSON.parse(await fsp.readFile(CONFIG_FILE, 'utf8'));
    cfg.widgets ||= [];
    return cfg;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Config illisible, valeurs par défaut utilisées :', e.message);
    await writeConfig(DEFAULT_CONFIG);
    return structuredClone(DEFAULT_CONFIG);
  }
}

async function writeConfig(cfg) {
  const tmp = CONFIG_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2));
  await fsp.rename(tmp, CONFIG_FILE);
}

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const SECRET_FIELDS = ['apiKey', 'password'];

function checkUrl(url) {
  if (url && !/^https?:\/\//i.test(url)) throw new Error(`URL invalide : ${url}`);
  return url;
}

// `previous` sert à conserver les secrets : le navigateur ne les reçoit jamais,
// donc un champ vide signifie « inchangé ».
function sanitizeWidgets(list, previous = []) {
  return (Array.isArray(list) ? list : []).map((w) => {
    const type = str(w.type, 32);
    if (!INTEGRATIONS[type]) throw new Error(`Type de widget inconnu : ${type}`);
    const id = str(w.id, 64) || 'wid-' + crypto.randomUUID();
    const old = previous.find((p) => p.id === id) || {};
    const out = { id, type, name: str(w.name, 100) || type, url: checkUrl(str(w.url, 2000)) };
    if (INTEGRATIONS[type].fields.includes('username')) out.username = str(w.username, 200);
    for (const f of SECRET_FIELDS) {
      if (INTEGRATIONS[type].fields.includes(f)) out[f] = str(w[f], 500) || old[f] || '';
    }
    return out;
  });
}

// Version envoyée au navigateur : sans clés API ni mots de passe.
function publicConfig(cfg) {
  return {
    ...cfg,
    widgets: cfg.widgets.map((w) => {
      const pub = { ...w };
      for (const f of SECRET_FIELDS) {
        if (f in pub) { pub['has' + f[0].toUpperCase() + f.slice(1)] = !!pub[f]; delete pub[f]; }
      }
      return pub;
    }),
  };
}

function sanitizeConfig(input, previous) {
  if (!input || !Array.isArray(input.categories)) throw new Error('categories manquant');
  return {
    title: str(input.title, 100) || 'Mon serveur',
    widgets: sanitizeWidgets(input.widgets, previous?.widgets),
    categories: input.categories.map((c) => ({
      id: str(c.id, 64) || 'cat-' + crypto.randomUUID(),
      name: str(c.name, 100) || 'Sans nom',
      apps: (Array.isArray(c.apps) ? c.apps : []).map((a) => {
        return {
          id: str(a.id, 64) || 'app-' + crypto.randomUUID(),
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
function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

function makeToken() {
  const exp = String(Date.now() + SESSION_TTL_MS);
  return `${exp}.${sign(exp)}`;
}

function verifyToken(token) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const isAuthed = (req) => verifyToken(getCookie(req, COOKIE_NAME));

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Non authentifié' });
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- Ping des services ----------
function ping(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve({ online: false, error: 'URL invalide' }); }
    const lib = u.protocol === 'https:' ? https : http;
    const start = Date.now();
    const req = lib.request(u, { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
      res.destroy();
      // Un 401/403 signifie que le service répond : on le considère en ligne.
      resolve({ online: res.statusCode < 500, code: res.statusCode, ms: Date.now() - start });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ online: false, error: e.message || e.code, ms: Date.now() - start }));
    req.end();
  });
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

async function diskInfo() {
  try {
    const s = await fsp.statfs(DISK_PATH);
    const total = s.blocks * s.bsize;
    return { total, used: total - s.bavail * s.bsize, path: DISK_PATH };
  } catch (e) {
    return { error: e.message, path: DISK_PATH };
  }
}

// ---------- Docker (API Engine via socket unix / named pipe) ----------
function docker(method, apiPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: DOCKER_SOCKET, path: apiPath, method, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Docker ${res.statusCode}: ${body}`));
        try { resolve(body ? JSON.parse(body) : null); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/me', (req, res) => res.json({ authenticated: isAuthed(req) }));

app.post('/api/login', (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeEqual(password, ADMIN_PASSWORD)) return res.status(401).json({ error: 'Mot de passe incorrect' });
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/config', async (req, res) => res.json(publicConfig(await readConfig())));

app.put('/api/config', requireAuth, async (req, res) => {
  try {
    const cfg = sanitizeConfig(req.body, await readConfig());
    await writeConfig(cfg);
    resetIntegrations();
    res.json(publicConfig(cfg));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/widgets/:id', async (req, res) => {
  const cfg = await readConfig();
  const widget = cfg.widgets.find((w) => w.id === req.params.id);
  if (!widget) return res.status(404).json({ error: 'Widget introuvable' });
  try {
    res.json(await fetchWidget(widget));
  } catch (e) {
    // Les erreurs réseau (ECONNREFUSED…) n'ont souvent pas de message.
    const error = e.code === 'ECONNREFUSED' ? 'Service injoignable (connexion refusée)'
      : e.code === 'ENOTFOUND' ? 'Adresse introuvable' : e.message || e.code || 'Erreur inconnue';
    res.status(502).json({ error });
  }
});

app.get('/api/status', async (req, res) => {
  const cfg = await readConfig();
  const apps = cfg.categories.flatMap((c) => c.apps).filter((a) => a.url);
  const results = await Promise.all(apps.map(async (a) => [a.id, await ping(a.url)]));
  res.json(Object.fromEntries(results));
});

app.get('/api/system', async (req, res) => {
  res.json({
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    uptime: os.uptime(),
    cpu: { usage: cpuUsage(), cores: os.cpus().length, model: os.cpus()[0]?.model, load: os.loadavg() },
    memory: await memInfo(),
    disk: await diskInfo(),
  });
});

app.get('/api/docker/containers', async (req, res) => {
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
    return res.status(400).json({ error: 'Requête invalide' });
  }
  try {
    await docker('POST', `/containers/${id}/${action}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server Dashboard sur http://localhost:${PORT}`));
