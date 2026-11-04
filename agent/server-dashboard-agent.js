#!/usr/bin/env node
// Agent Server Dashboard : envoie les ressources de cette machine (CPU, mémoire, disques, température,
// uptime, mises à jour en attente) au dashboard, toutes les AGENT_INTERVAL secondes. C'est la machine qui contacte le dashboard :
// rien à ouvrir sur son pare-feu, ça marche derrière un NAT. Node.js 18.15 ou plus récent, sans dépendance.
//
//   DASHBOARD_URL=http://192.168.1.10:7575 AGENT_ID=wid-… AGENT_TOKEN=… node server-dashboard-agent.js
//
// La commande exacte (identifiant et jeton compris) est donnée par le dashboard : mode édition, widget
// « Agent ». Variables facultatives :
//   AGENT_INTERVAL  secondes entre deux envois (30 par défaut, 5 au minimum)
//   AGENT_DISKS     disques à surveiller, séparés par des virgules (« / » ou « C:\ » par défaut)
//   AGENT_UPDATES   heures entre deux recherches de mises à jour (6 par défaut, 0 pour désactiver)
//   DOCKER_SOCKET   socket de l'API Docker, pour les images à mettre à jour
//   --once          un seul envoi, puis arrêt (pour tester)
//
// L'agent garde aussi une demande ouverte vers le dashboard : le bouton ⟳ du widget y répond tout de suite,
// et l'agent envoie alors ses valeurs sans attendre le prochain envoi. Aucun port n'est ouvert sur la machine.

const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');

const URL_BASE = (process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
const ID = process.env.AGENT_ID || '';
const TOKEN = process.env.AGENT_TOKEN || '';
const INTERVAL = Math.min(86400, Math.max(5, Number(process.env.AGENT_INTERVAL) || 30));
const DISKS = (process.env.AGENT_DISKS || (process.platform === 'win32' ? 'C:\\' : '/')).split(',').map((d) => d.trim()).filter(Boolean);
const ONCE = process.argv.includes('--once');
const UPDATES_HOURS = process.env.AGENT_UPDATES === undefined ? 6 : Math.max(0, Number(process.env.AGENT_UPDATES) || 0);

// CPU : écart entre deux relevés (le premier envoi mesure sur une seconde).
let lastCpu = os.cpus();
function cpuPercent() {
  const now = os.cpus();
  let idle = 0;
  let total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i]?.times || { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    idle += c.times.idle - p.idle;
    total += Object.keys(c.times).reduce((n, k) => n + c.times[k] - (p[k] || 0), 0);
  });
  lastCpu = now;
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

function memory() {
  // Linux : MemAvailable tient compte du cache, contrairement à os.freemem().
  try {
    const txt = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (k) => Number((txt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1]) * 1024;
    if (get('MemTotal') && get('MemAvailable')) return { total: get('MemTotal'), used: get('MemTotal') - get('MemAvailable') };
  } catch { /* pas Linux */ }
  return { total: os.totalmem(), used: os.totalmem() - os.freemem() };
}

function disks() {
  return DISKS.flatMap((mount) => {
    try {
      const s = fs.statfsSync(mount);
      return [{ mount, size: s.blocks * s.bsize, used: (s.blocks - s.bavail) * s.bsize }];
    } catch {
      return []; // disque absent ou démonté
    }
  });
}

// Température la plus haute des zones thermiques (Linux, Raspberry Pi…). Une zone illisible (capteur
// désactivé : EINVAL, ENODATA) est ignorée sans faire perdre les autres.
function temperature() {
  let zones;
  try {
    zones = fs.readdirSync('/sys/class/thermal').filter((z) => z.startsWith('thermal_zone'));
  } catch {
    return null; // pas Linux
  }
  const values = zones.flatMap((z) => {
    try {
      return [Number(fs.readFileSync(`/sys/class/thermal/${z}/temp`, 'utf8')) / 1000];
    } catch {
      return [];
    }
  }).filter((v) => v > 0 && v < 150);
  return values.length ? { value: Math.round(Math.max(...values)), label: 'CPU' } : null;
}

function osName() {
  try {
    const m = fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (m) return m[1];
  } catch { /* pas Linux */ }
  return `${os.type()} ${os.release()}`;
}

function report() {
  const cores = os.cpus().length;
  return {
    hostname: os.hostname(),
    os: osName(),
    uptime: Math.round(os.uptime()),
    cpu: cpuPercent(),
    cpuName: os.cpus()[0]?.model?.trim() || '',
    // Pas de charge moyenne sous Windows (os.loadavg() renvoie des zéros).
    load: process.platform === 'win32' ? null : { min1: Math.round(os.loadavg()[0] * 100) / 100, cores },
    mem: memory(),
    disks: disks(),
    temp: temperature(),
    interval: INTERVAL,
    updates: UPDATES_HOURS ? updates : undefined,
  };
}

// ---------- Mises à jour en attente (#122) ----------
// Comptées seulement : rien n'est installé. Fonctions aussi utilisées par le dashboard pour sa propre
// machine (integrations/updates.js) ; aucune dépendance, pour que ce script reste un seul fichier.
const MIN_RECHECK_MS = 60_000; // bouton ⟳ : pas plus d'une recherche de mises à jour par minute
const MAX_PACKAGES = 100;
const MAX_IMAGES = 50;
const REGISTRY_TIMEOUT_MS = 10_000;
const MANIFESTS = [
  'application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

// Sortie de « apt-get -s dist-upgrade », l'interface stable d'apt pour les scripts :
//   Inst libssl3 [3.0.11-1] (3.0.13-1 Debian-Security:12/stable-security [amd64])
function parseApt(text) {
  const all = text.split('\n').flatMap((line) => {
    const m = line.match(/^Inst (\S+) \[[^\]]*\] \((\S+) ([^)]*)\)/);
    return m ? [{ name: m[1], version: m[2], security: /security/i.test(m[3]) }] : [];
  });
  const security = all.filter((x) => x.security);
  return { count: all.length, security: security.length, names: [...security, ...all.filter((x) => !x.security)].slice(0, MAX_PACKAGES) };
}

// Date du dernier « apt update » : le dossier partial change même si aucune liste n'a changé.
function aptListsDate() {
  const dates = ['/var/lib/apt/lists', '/var/lib/apt/lists/partial'].flatMap((dir) => {
    try {
      return [fs.statSync(dir).mtimeMs];
    } catch {
      return [];
    }
  });
  return dates.length ? Math.max(...dates) : null;
}

// null : pas de paquets apt ici (autre système, ou conteneur : on y remplace l'image, pas les paquets).
function aptUpdates() {
  if (process.platform !== 'linux' || fs.existsSync('/.dockerenv')) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('apt-get', ['-s', 'dist-upgrade'], { env: { ...process.env, LC_ALL: 'C' }, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(err.code === 'ENOENT' ? null : { error: 'apt' });
      resolve({ ...parseApt(stdout), listsAt: aptListsDate() });
    });
  });
}

function dockerGet(socket, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath: socket, path, timeout: 5000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}

// nginx -> registry-1.docker.io, library/nginx, latest ; ghcr.io/a/b:1 -> ghcr.io, a/b, 1
function parseImage(ref) {
  const first = ref.split('/')[0];
  const hasHost = ref.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost');
  let path = hasHost ? ref.slice(first.length + 1) : ref;
  const colon = path.lastIndexOf(':');
  const tag = colon > path.lastIndexOf('/') ? path.slice(colon + 1) : 'latest';
  if (colon > path.lastIndexOf('/')) path = path.slice(0, colon);
  const hub = !hasHost || first === 'docker.io' || first === 'index.docker.io';
  if (hub && !path.includes('/')) path = `library/${path}`;
  return { registry: hub ? 'registry-1.docker.io' : first, path, tag };
}

// Empreinte du tag sur le registre, sans compte : null si elle n'est pas lisible (image privée…).
// HEAD ne compte pas dans la limite de téléchargements de Docker Hub.
async function remoteDigest({ registry, path, tag }) {
  const scheme = /^(localhost|127\.)/.test(registry) ? 'http' : 'https';
  const head = (url, headers = {}) => fetch(url, { method: 'HEAD', headers: { Accept: MANIFESTS, ...headers }, signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) });
  let res = await head(`${scheme}://${registry}/v2/${path}/manifests/${tag}`);
  if (res.status === 401) {
    // Jeton anonyme demandé là où le registre l'indique. res.url : après une redirection (lscr.io -> ghcr.io).
    const auth = res.headers.get('www-authenticate') || '';
    const param = (k) => auth.match(new RegExp(`${k}="([^"]*)"`))?.[1];
    if (!/^bearer/i.test(auth) || !param('realm')) return null;
    const url = new URL(param('realm'));
    if (param('service')) url.searchParams.set('service', param('service'));
    url.searchParams.set('scope', param('scope') || `repository:${path}:pull`);
    const token = await fetch(url, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) });
    if (!token.ok) return null;
    const body = await token.json();
    res = await head(res.url, { Authorization: `Bearer ${body.token || body.access_token}` });
  }
  return res.ok ? res.headers.get('docker-content-digest') : null;
}

// Une image à vérifier : 'update', 'ok', 'unknown' (privée, construite ici, registre injoignable)
// ou 'pinned' (fixée par son empreinte : elle ne change jamais).
async function imageState(socket, ref, imageId) {
  if (ref.includes('@')) return { state: 'pinned', image: ref };
  try {
    const { RepoDigests: digests = [] } = await dockerGet(socket, `/images/${encodeURIComponent(imageId)}/json`);
    // Le tag est parti vers une image plus récente, déjà téléchargée : conteneur à recréer.
    if (ref.startsWith('sha256:')) {
      return digests.length ? { state: 'update', image: digests[0].split('@')[0] } : { state: 'unknown', image: ref };
    }
    if (!digests.length) return { state: 'unknown', image: ref };
    const digest = await remoteDigest(parseImage(ref));
    if (!digest) return { state: 'unknown', image: ref };
    return { state: digests.some((d) => d.endsWith(`@${digest}`)) ? 'ok' : 'update', image: ref };
  } catch {
    return { state: 'unknown', image: ref };
  }
}

// Images des conteneurs lancés. Seul un changement du même tag est vu : nginx:1.25 ne propose pas 1.26.
async function dockerUpdates(socket) {
  let containers;
  try {
    containers = await dockerGet(socket, '/containers/json');
  } catch (e) {
    return e.code === 'EACCES' ? { error: 'denied' } : null; // sans Docker : rien à afficher
  }
  const images = new Map();
  for (const c of containers) {
    const key = `${c.Image} ${c.ImageID}`;
    if (!images.has(key)) images.set(key, { ref: c.Image, id: c.ImageID, containers: [] });
    images.get(key).containers.push((c.Names?.[0] || '').replace(/^\//, ''));
  }
  const list = [...images.values()].slice(0, MAX_IMAGES * 2);
  const results = [];
  for (let i = 0; i < list.length; i += 4) { // 4 à la fois : pas de rafale sur les registres
    results.push(...await Promise.all(list.slice(i, i + 4).map(async (x) => ({ ...await imageState(socket, x.ref, x.id), containers: x.containers }))));
  }
  const pending = results.filter((r) => r.state === 'update');
  return {
    count: pending.length,
    images: pending.slice(0, MAX_IMAGES).map(({ image, containers: names }) => ({ image, containers: names.slice(0, 3) })),
    unknown: results.filter((r) => r.state === 'unknown').length,
  };
}

async function checkUpdates({ socket } = {}) {
  const dockerSocket = socket || process.env.DOCKER_SOCKET || (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock');
  const [packages, docker] = await Promise.all([aptUpdates(), dockerUpdates(dockerSocket)]);
  return { checkedAt: Date.now(), packages, docker };
}

let updates = null;
let updatesAt = 0;

// La promesse de la recherche, ou rien si la dernière est assez récente.
function refreshUpdates() {
  if (!UPDATES_HOURS || Date.now() - updatesAt < UPDATES_HOURS * 3600_000) return null;
  updatesAt = Date.now();
  return checkUpdates().then((u) => { updates = u; }, (e) => console.error(`Recherche de mises à jour impossible : ${e.message}`));
}

async function send() {
  const res = await fetch(`${URL_BASE}/api/agent/${encodeURIComponent(ID)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(report()),
    signal: AbortSignal.timeout(15_000),
    // Une redirection (http -> https derrière un reverse proxy) changerait le POST en GET sans corps.
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`le dashboard redirige vers ${res.headers.get('location')} : mets cette adresse dans DASHBOARD_URL`);
  }
  if (res.status === 401 || res.status === 404) throw new Error('jeton ou identifiant refusé : recopie la commande donnée par le dashboard');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Le résultat d'une recherche part dès qu'il est prêt, après le délai minimal entre deux envois (2 s côté
// dashboard) : sans lui, une recherche rapide serait refusée et attendrait l'envoi suivant.
function sendWhenDone(searching) {
  searching?.then(() => new Promise((r) => { setTimeout(r, 3000); })).then(send).catch(() => {});
}

// Demande ouverte vers le dashboard, relancée dès qu'elle se termine (il répond au bout de 25 s sans demande).
const WAIT_TIMEOUT_MS = 40_000;
const WAIT_RETRY_MS = 30_000; // dashboard injoignable, ou trop ancien pour cette demande

async function waitLoop() {
  for (;;) {
    try {
      const res = await fetch(`${URL_BASE}/api/agent/${encodeURIComponent(ID)}/wait`, {
        headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(WAIT_TIMEOUT_MS), redirect: 'manual',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const command = await res.json();
      if (command.refresh) {
        if (command.updates && Date.now() - updatesAt >= MIN_RECHECK_MS) updatesAt = 0;
        sendWhenDone(refreshUpdates());
        await send();
      }
    } catch {
      // Les erreurs d'envoi sont déjà signalées par la boucle principale.
      await new Promise((r) => { setTimeout(r, WAIT_RETRY_MS); });
    }
  }
}

let failures = 0;
async function loop() {
  try {
    // Un envoi n'attend pas la recherche, qui peut être longue (sauf --once : il n'y a qu'un envoi).
    const searching = refreshUpdates();
    if (ONCE) await searching;
    else sendWhenDone(searching);
    await send();
    if (failures) console.log('Envoi rétabli.');
    failures = 0;
  } catch (e) {
    // Un message au premier échec puis toutes les 10 tentatives : pas de journal qui déborde.
    if (failures++ % 10 === 0) console.error(`Envoi impossible vers ${URL_BASE} : ${e.cause?.code || e.message}`);
    if (ONCE) process.exit(1);
  }
  if (ONCE) return;
  setTimeout(loop, INTERVAL * 1000);
}

if (require.main === module) {
  if (!URL_BASE || !ID || !TOKEN) {
    console.error('DASHBOARD_URL, AGENT_ID et AGENT_TOKEN sont obligatoires (commande donnée par le dashboard).');
    process.exit(1);
  }
  // fetch (Node 18) et fs.statfsSync (Node 18.15, pour les disques).
  if (typeof fetch !== 'function' || typeof fs.statfsSync !== 'function') {
    console.error(`Node.js 18.15 ou plus récent est nécessaire (version actuelle : ${process.version}).`);
    process.exit(1);
  }
  console.log(`Agent Server Dashboard : envoi toutes les ${INTERVAL} s vers ${URL_BASE}`);
  setTimeout(loop, 1000); // une seconde de mesure pour le premier relevé du CPU
  if (!ONCE) waitLoop();
}

module.exports = { checkUpdates, parseApt, parseImage };
