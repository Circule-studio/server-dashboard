// Server Dashboard — backend Express
// API : config des tuiles, statut des services, stats système, Docker, auth admin.

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { INTEGRATIONS, fetchWidget, resetIntegrations, request, orStale } = require('./integrations');
const { NOTIFY_TYPES, sendNotification, createMonitor } = require('./notify');

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
  if (configCache) {
    resetIntegrations();
    statusCache = null;
  }
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

// Erreur avec un code traduisible par l'interface (err.* dans public/i18n.js).
const fail = (key, message, params) => Object.assign(new Error(message), { key, params });

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const SECRET_FIELDS = ['apiKey', 'password'];

function checkUrl(url) {
  if (url && !/^https?:\/\//i.test(url)) throw fail('invalid_url', `URL invalide : ${url}`, { url });
  return url;
}

// Dépôt GitHub : « propriétaire/dépôt », ou une adresse copiée (https://github.com/propriétaire/dépôt/issues,
// github.com/propriétaire/dépôt, git@github.com:propriétaire/dépôt.git…), ramenée à « propriétaire/dépôt ».
function githubRepo(value) {
  const path = value
    .replace(/^[a-z+]+:\/\/[^/]+/i, '') // https://github.com, ssh://git@github.com
    .replace(/^git@[^:/]+:/i, '')
    .replace(/^\/+/, '')
    .replace(/^[^/]*\.[^/]*\//, ''); // hôte sans « https:// » : un propriétaire GitHub n'a pas de point
  const [owner = '', name = ''] = path.split(/[/?#]/);
  const repo = `${owner}/${name.replace(/\.git$/i, '')}`;
  // Noms autorisés par GitHub ; « . » et « .. » sont exclus (ils changeraient le chemin de l'API).
  if (!/^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/.test(repo)) throw fail('github_repo_invalid', `Dépôt invalide : ${value}`, { repo: value });
  return repo;
}

// Page de statut Uptime Kuma : son nom (slug), ou l'adresse de la page collée dans l'URL
// (http://IP:3001/status/maison, aussi derrière un chemin de reverse proxy) dont on tire l'URL et le nom.
function statusPage(url, slug) {
  const pasted = url.match(/^(https?:\/\/.+?)\/status\/([^/?#]+)\/?(?:[?#].*)?$/i);
  const out = { url: pasted ? pasted[1] : url, slug: slug || (pasted ? pasted[2] : '') };
  if (!/^[a-z0-9-]{1,100}$/i.test(out.slug)) throw fail('kuma_slug_invalid', `Page de statut invalide : ${out.slug}`, { slug: out.slug });
  return out;
}

// Entités Home Assistant : « domaine.nom » (sensor.salon_temperature), une par ligne ou séparées
// par des virgules dans le formulaire. Sans doublon, 30 au plus.
const MAX_ENTITIES = 30;

function sanitizeEntities(list) {
  const raw = Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/);
  const entities = [...new Set(raw.map((e) => str(e, 255).toLowerCase()).filter(Boolean))];
  const invalid = entities.find((e) => !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(e));
  if (invalid) throw fail('ha_entity_invalid', `Entité invalide : ${invalid}`, { entity: invalid });
  if (!entities.length) throw fail('ha_entities_missing', 'Aucune entité choisie');
  if (entities.length > MAX_ENTITIES) throw fail('ha_too_many', `${MAX_ENTITIES} entités au plus`, { max: MAX_ENTITIES });
  return entities;
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
    // Même type seulement : la clé d'un ancien widget Sonarr ne doit pas partir vers un Radarr.
    const old = (raw && previous.filter((p) => p.id === raw)[n]) || {};
    if (old.type && old.type !== type) for (const f of SECRET_FIELDS) delete old[f];
    const out = { id, type, name: str(w.name, 100) || type, url: checkUrl(str(w.url, 2000)) };
    // Le nom d'utilisateur n'est envoyé qu'aux admins : absent de la requête = inchangé.
    if (INTEGRATIONS[type].fields.includes('username')) {
      out.username = typeof w.username === 'string' ? str(w.username, 200) : old.username || '';
      if (INTEGRATIONS[type].userRequired && !out.username) throw fail('username_required', `Utilisateur obligatoire (${type})`, { type });
    }
    // Lieu de la météo : nom de ville ou coordonnées.
    if (INTEGRATIONS[type].fields.includes('location')) out.location = str(w.location, 200);
    if (INTEGRATIONS[type].fields.includes('entities')) out.entities = sanitizeEntities(w.entities);
    if (INTEGRATIONS[type].fields.includes('slug')) Object.assign(out, statusPage(out.url, str(w.slug, 100)));
    if (INTEGRATIONS[type].fields.includes('repo')) {
      out.repo = githubRepo(str(w.repo, 300));
      // Nom par défaut : le dépôt normalisé (le navigateur affiche le type en attendant l'enregistrement).
      if (!str(w.name, 100)) out.name = out.repo;
    }
    // Blocs à afficher, pour les intégrations qui en proposent (ex. Pulse).
    const allowed = INTEGRATIONS[type].sections;
    if (allowed) {
      const chosen = (Array.isArray(w.sections) ? w.sections : []).filter((s) => allowed.includes(s));
      out.sections = chosen.length ? [...new Set(chosen)] : [...allowed];
    }
    // Jeton créé par le serveur (agent) : jamais saisi, gardé d'un enregistrement à l'autre.
    // regenerateKey : nouveau jeton demandé (l'ancien cesse de marcher).
    if (INTEGRATIONS[type].generatedKey) {
      out.apiKey = (w.regenerateKey !== true && old.apiKey) || crypto.randomBytes(24).toString('base64url');
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
  const { notify, ...rest } = cfg;
  return {
    ...rest,
    // Notifications : réglage visible des admins seulement, sans l'URL ni le jeton.
    ...(authed && notify ? { notify: { type: notify.type, lang: notify.lang, hasUrl: !!notify.url, hasToken: !!notify.token } } : {}),
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

// Notifications. `url` et `token` sont des secrets : vides = inchangés (si le type ne change pas),
// clearToken = effacer le jeton. Sans type : désactivées.
function sanitizeNotify(input, previous) {
  if (input === undefined) return previous || { type: '' }; // ancienne interface : inchangées
  const src = input && typeof input === 'object' ? input : {};
  const type = NOTIFY_TYPES.includes(src.type) ? src.type : '';
  if (!type) return { type: '' };
  const same = previous?.type === type ? previous : {};
  const out = {
    type,
    lang: src.lang === 'en' ? 'en' : 'fr',
    url: checkUrl(str(src.url, 2000)) || same.url || '',
    token: src.clearToken === true ? '' : str(src.token, 500) || same.token || '',
  };
  if (!out.url) throw fail('notify_url_missing', 'URL de notification manquante');
  // ntfy : l'adresse du sujet (https://ntfy.sh/mon-sujet), pas seulement celle du serveur.
  let pathname;
  try { ({ pathname } = new URL(out.url)); } catch { throw fail('invalid_url', `URL invalide : ${out.url}`, { url: out.url }); }
  if (type === 'ntfy' && pathname.replace(/\/+$/, '') === '') throw fail('notify_topic_missing', 'Sujet ntfy manquant');
  if (type === 'gotify' && !out.token) throw fail('notify_token_missing', 'Jeton Gotify manquant');
  return out;
}

// Taille des tuiles d'apps (réglage global).
const TILE_SIZES = ['compact', 'normal', 'large'];

function sanitizeDisplay(display) {
  const src = display && typeof display === 'object' ? display : {};
  return Object.fromEntries(DISPLAY_OPTIONS.map((k) => [k, src[k] !== false]));
}

// Mise en page : ordre et largeur (1 à 12 colonnes) des widgets et des catégories
// dans la grille. Seuls les éléments qui existent sont gardés ; ceux qui manquent
// sont placés par l'interface (largeur par défaut, à la fin).
const LAYOUT_KINDS = { widget: 'widgets', category: 'categories' };

function sanitizeLayout(layout, cfg) {
  const seen = new Set();
  return (Array.isArray(layout) ? layout : []).slice(0, 1000).flatMap((it) => {
    const kind = it && LAYOUT_KINDS[it.kind] ? it.kind : null;
    const id = str(it?.id, 64);
    const key = `${kind}:${id}`;
    if (!kind || seen.has(key) || !cfg[LAYOUT_KINDS[kind]].some((x) => x.id === id)) return [];
    seen.add(key);
    const w = Math.round(Number(it.w));
    const out = { kind, id, w: Number.isFinite(w) ? Math.min(12, Math.max(1, w)) : 12 };
    // Hauteur fixe en pixels (#75), facultative : sans elle, la hauteur suit le contenu.
    const h = Math.round(Number(it.h));
    if (it.h != null && Number.isFinite(h)) out.h = Math.min(3000, Math.max(60, h));
    return [out];
  });
}

// Ordre des cartes de stats : cpu, mem, up et disk:<chemin>.
function sanitizeStatsOrder(order) {
  const keys = (Array.isArray(order) ? order : []).map((k) => str(k, 520))
    .filter((k) => ['cpu', 'mem', 'up'].includes(k) || /^disk:./.test(k));
  return [...new Set(keys)].slice(0, 50);
}

function sanitizeConfig(input, previous) {
  if (!input || !Array.isArray(input.categories)) throw fail('bad_request', 'categories manquant');
  const catIds = new Set();
  const appIds = new Set(); // uniques sur tout le tableau : /api/status les range par identifiant
  const cfg = {
    revision: (previous?.revision || 0) + 1,
    title: str(input.title, 100) || 'Mon serveur',
    // Absent de la requête (ancienne interface) = inchangé.
    display: sanitizeDisplay(input.display ?? previous?.display),
    // Absente ou invalide (ancienne interface, script) : inchangée.
    tileSize: [input.tileSize, previous?.tileSize].find((s) => TILE_SIZES.includes(s)) || 'normal',
    widgets: sanitizeWidgets(input.widgets, previous?.widgets),
    notify: sanitizeNotify(input.notify, previous?.notify),
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
  // Absentes de la requête (ancienne interface) = inchangées.
  cfg.layout = sanitizeLayout(input.layout ?? previous?.layout, cfg);
  cfg.statsOrder = sanitizeStatsOrder(input.statsOrder ?? previous?.statsOrder);
  return cfg;
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
// Relevés des agents : petits, et reçus de machines hors de la session admin (64 Ko au plus).
const jsonBody = express.json({ limit: '1mb' });
const agentBody = express.json({ limit: '64kb' });
app.use((req, res, next) => (req.path.startsWith('/api/agent/') ? agentBody : jsonBody)(req, res, next));
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

// Export de la config (mode édition > Sauvegarde), admin seulement. Sans ?secrets=1, les clés API
// et mots de passe sont retirés : le fichier peut être partagé. L'import se fait dans le navigateur,
// puis passe par PUT /api/config comme un enregistrement normal.
const EXPORT_FORMAT = 'server-dashboard-config';
const { version: APP_VERSION } = require('./package.json');

app.get('/api/config/export', requireAuth, route(async (req, res) => {
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

// Images d'un widget (miniatures des événements Frigate) : passent par le dashboard, avec les
// mêmes droits que ses données (REQUIRE_LOGIN), pour ne jamais exposer le service lui-même.
app.get('/api/widgets/:id/thumbnail/:key', readAuth, route(async (req, res) => {
  const cfg = await readConfig();
  const widget = cfg.widgets.find((w) => w.id === req.params.id);
  const thumbnail = widget && INTEGRATIONS[widget.type].thumbnail;
  if (!thumbnail) return res.status(404).json({ error: 'Introuvable', code: 'not_found' });
  let image;
  try {
    image = await thumbnail(widget, req.params.key);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Erreur inconnue', code: e.key, params: e.params });
  }
  if (!image) return res.status(404).json({ error: 'Introuvable', code: 'not_found' });
  // Gardée par le navigateur (jamais par un proxy partagé). Événement en cours (?live) : Frigate
  // remplace la miniature quand il trouve une meilleure image, elle n'est donc gardée que 10 s.
  const maxAge = 'live' in req.query ? 10 : 86400;
  res.set({ 'Content-Type': image.type, 'Cache-Control': `private, max-age=${maxAge}`, 'X-Content-Type-Options': 'nosniff' });
  res.send(image.body);
}));

// ---------- Agents (machines qui envoient elles-mêmes leurs ressources) ----------
// Authentifiés par le jeton de leur widget, pas par le cookie : REQUIRE_LOGIN ne s'applique pas.
const AGENT_SCRIPT = path.join(__dirname, 'agent', 'server-dashboard-agent.js');

function agentWidget(cfg, id) {
  const w = cfg.widgets.find((x) => x.id === id);
  return w && INTEGRATIONS[w.type]?.receive ? w : null;
}

app.post('/api/agent/:id', route(async (req, res) => {
  const w = agentWidget(await readConfig(), req.params.id);
  if (!w) return res.status(404).json({ error: 'Introuvable', code: 'not_found' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!w.apiKey || !safeEqual(token, w.apiKey)) return res.status(401).json({ error: 'Jeton refusé', code: 'auth_refused' });
  if (!INTEGRATIONS[w.type].receive(w, req.body)) return res.status(429).json({ error: 'Trop d\'envois', code: 'too_many_attempts' });
  res.json({ ok: true });
}));

// Identifiant et jeton de l'agent, pour sa commande d'installation : admin seulement. L'adresse du
// dashboard est celle du navigateur de l'admin (juste même derrière un reverse proxy HTTPS).
app.get('/api/agent/:id/setup', requireAuth, route(async (req, res) => {
  const w = agentWidget(await readConfig(), req.params.id);
  if (!w) return res.status(404).json({ error: 'Introuvable', code: 'not_found' });
  res.set('Cache-Control', 'no-store');
  res.json({ id: w.id, token: w.apiKey });
}));

app.get('/agent/server-dashboard-agent.js', (req, res) => res.type('application/javascript').sendFile(AGENT_SCRIPT));

app.get('/api/status', readAuth, route(async (req, res) => res.json(await getStatuses(STATUS_CACHE_MS, { stale: true }))));

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

// ---------- Notifications : vérification des apps en tâche de fond ----------
// Toutes les NOTIFY_INTERVAL_MS, même sans visiteur, quand des notifications sont configurées.
// Le résultat sert aussi aux visiteurs (statusCache), pour ne pas pinguer deux fois.
const NOTIFY_INTERVAL_MS = Number(process.env.NOTIFY_INTERVAL_MS) || 60_000;
const monitor = createMonitor();
let monitoring = false;

async function checkForNotifications() {
  if (monitoring) return; // vérification précédente pas finie (services lents)
  monitoring = true;
  try {
    const cfg = await readConfig();
    if (!cfg.notify?.type) { monitor.clear(); return; } // réactivées plus tard : pas d'alerte sur l'état ancien
    // Statuts d'un visiteur réutilisés s'ils sont assez récents : pas de double ping.
    const statuses = await getStatuses(Math.min(STATUS_CACHE_MS, NOTIFY_INTERVAL_MS / 2));
    const events = monitor.update(cfg.categories.flatMap((c) => c.apps).filter((a) => a.url), statuses);
    // En parallèle : un service lent ne retarde pas les autres alertes ; un échec repart au tour suivant.
    await Promise.all(events.map((event) => sendNotification(cfg.notify, { ...event, board: cfg.title }).catch((e) => {
      monitor.failed(event);
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
app.post('/api/notify/test', requireAuth, route(async (req, res) => {
  const cfg = await readConfig();
  let notify;
  try {
    notify = sanitizeNotify(req.body || {}, cfg.notify);
    if (!notify.type) throw fail('notify_missing', 'Notifications non configurées');
  } catch (e) {
    return res.status(400).json({ error: e.message, code: e.key || 'bad_request', params: e.params });
  }
  try {
    await sendNotification(notify, { kind: 'test', board: cfg.title });
  } catch (e) {
    return res.status(502).json({ error: e.message, code: e.key, params: e.params });
  }
  res.json({ ok: true });
}));

// Express 5 passe l'erreur d'écoute (port déjà pris…) au rappel : sans ce contrôle, le dashboard
// annonçait démarrer puis s'arrêtait avec le code 0, que systemd (Restart=on-failure) ne relance pas.
app.listen(PORT, (err) => {
  if (err) {
    console.error(`[!] Impossible d'écouter sur le port ${PORT} : ${err.code === 'EADDRINUSE' ? 'déjà utilisé par un autre programme' : err.message}`);
    process.exit(1);
  }
  console.log(`Server Dashboard sur http://localhost:${PORT}`);
});
