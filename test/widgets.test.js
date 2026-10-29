// Tests de bout en bout des widgets avec les faux services (dev/mocks.js) : npm test.
// Lance les faux services et un dashboard (données dans un dossier temporaire), enregistre un
// widget de chaque type, puis vérifie les données renvoyées, les erreurs traduites et
// qu'aucun secret n'arrive au navigateur. Uniquement node:test : aucune dépendance.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 17999;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'test-admin';
const DOCKER_SOCKET = process.platform === 'win32'
  ? '\\\\.\\pipe\\server-dashboard-mock-docker'
  : path.join(os.tmpdir(), 'server-dashboard-mock-docker.sock');

const children = [];
let dataDir;
let cookie = '';

// Lance un script et attend qu'il écrive `ready` sur sa sortie (ou échoue s'il s'arrête avant).
function start(script, env, ready) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: ROOT, env: { ...process.env, ...env } });
    children.push(child);
    let out = '';
    const timer = setTimeout(() => reject(new Error(`${script} : pas prêt après 15 s\n${out}`)), 15_000);
    const onData = (d) => {
      out += d;
      if (out.includes(ready)) { clearTimeout(timer); resolve(child); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`${script} s'est arrêté (code ${code})\n${out}`)); });
  });
}

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* pas du JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

// Un widget de chaque type, branché sur son faux service (identifiants : en tête de dev/mocks.js).
const WIDGETS = [
  { id: 'jellyfin', type: 'jellyfin', url: 'http://localhost:18096', apiKey: 'jf-key' },
  { id: 'plex', type: 'plex', url: 'http://localhost:13240', apiKey: 'plex-token' },
  { id: 'qbittorrent', type: 'qbittorrent', url: 'http://localhost:18080', username: 'admin', password: 'secret' },
  { id: 'sonarr', type: 'sonarr', url: 'http://localhost:18989', apiKey: 'sonarr-key' },
  { id: 'radarr', type: 'radarr', url: 'http://localhost:17878', apiKey: 'radarr-key' },
  { id: 'proxmox', type: 'proxmox', url: 'http://localhost:18006', username: 'root@pam!dashboard', apiKey: 'pve-secret' },
  { id: 'pulse', type: 'pulse', url: 'http://localhost:17655', apiKey: 'pulse-token' },
  { id: 'weather', type: 'weather', url: 'http://localhost:18765', location: 'Nantes' },
  { id: 'immich', type: 'immich', url: 'http://localhost:12283', apiKey: 'immich-key' },
  { id: 'pihole', type: 'pihole', url: 'http://localhost:10080', password: 'pihole-pass' },
  { id: 'adguard', type: 'adguard', url: 'http://localhost:13000', username: 'admin', password: 'adguard-pass' },
  { id: 'kuma', type: 'uptimekuma', url: 'http://localhost:13001', slug: 'maison' },
  { id: 'kuma-pasted', type: 'uptimekuma', url: 'http://localhost:13001/status/maison' },
  { id: 'glances-pc', type: 'glances', url: 'http://localhost:61208' },
  { id: 'glances-pi', type: 'glances', url: 'http://localhost:61209', password: 'glances-pass' },
  { id: 'frigate', type: 'frigate', url: 'http://localhost:15000' },
  { id: 'frigate-auth', type: 'frigate', url: 'http://localhost:18971', username: 'viewer', password: 'frigate-pass' },
  { id: 'ha', type: 'homeassistant', url: 'http://localhost:18123', apiKey: 'ha-token', entities: 'sensor.salon_temperature, binary_sensor.porte_entree\nbinary_sensor.mouvement_couloir light.salon person.thomas sensor.cave_humidite sensor.supprime sensor.salon_temperature' },
  { id: 'npm', type: 'npm', url: 'http://localhost:10081', username: 'admin@example.com', password: 'npm-pass' },
  { id: 'github', type: 'github', url: 'http://localhost:14000', repo: 'https://github.com/circule-studio/server-dashboard' },
  // Cas d'erreur : chacun doit renvoyer un code que l'interface traduit.
  { id: 'jellyfin-bad', type: 'jellyfin', url: 'http://localhost:18096', apiKey: 'mauvaise-cle' },
  { id: 'plex-bad', type: 'plex', url: 'http://localhost:13240', apiKey: 'mauvais-token' },
  { id: 'qbit-bad', type: 'qbittorrent', url: 'http://localhost:18080', username: 'admin', password: 'faux' },
  { id: 'immich-user', type: 'immich', url: 'http://localhost:12283', apiKey: 'immich-user-key' },
  { id: 'pihole-bad', type: 'pihole', url: 'http://localhost:10080', password: 'faux' },
  { id: 'adguard-bad', type: 'adguard', url: 'http://localhost:13000', username: 'admin', password: 'faux' },
  { id: 'weather-unknown', type: 'weather', url: 'http://localhost:18765', location: 'Ville qui n’existe pas' },
  { id: 'kuma-missing', type: 'uptimekuma', url: 'http://localhost:13001', slug: 'inconnue' },
  { id: 'glances-bad', type: 'glances', url: 'http://localhost:61209', password: 'faux' },
  { id: 'glances-off', type: 'glances', url: 'http://localhost:61299' },
  { id: 'frigate-noauth', type: 'frigate', url: 'http://localhost:18971' },
  { id: 'frigate-bad', type: 'frigate', url: 'http://localhost:18971', username: 'viewer', password: 'faux' },
  { id: 'ha-bad', type: 'homeassistant', url: 'http://localhost:18123', apiKey: 'mauvais-jeton', entities: ['light.salon'] },
  { id: 'npm-bad', type: 'npm', url: 'http://localhost:10081', username: 'admin@example.com', password: 'faux' },
  { id: 'github-private', type: 'github', url: 'http://localhost:14000', repo: 'demo/private' },
  { id: 'github-limit', type: 'github', url: 'http://localhost:14000', repo: 'demo/rate-limited' },
  { id: 'unreachable', type: 'sonarr', url: 'http://localhost:9', apiKey: 'x' },
];
const SECRETS = ['jf-key', 'secret', 'sonarr-key', 'radarr-key', 'pve-secret', 'pulse-token', 'immich-key', 'pihole-pass', 'adguard-pass', 'mauvaise-cle', 'immich-user-key', 'npm-pass', 'ha-token', 'mauvais-jeton', 'frigate-pass', 'glances-pass', 'plex-token', 'mauvais-token'];

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-test-'));
  await start('dev/mocks.js', {}, 'mocks prêts');
  // Vérification des apps pour les notifications : 200 ms au lieu d'une minute.
  await start('server.js', { PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: PASSWORD, DOCKER_SOCKET, NOTIFY_INTERVAL_MS: '200' }, 'Server Dashboard sur');
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(login.status, 200, 'connexion admin');
  cookie = login.headers.get('set-cookie').split(';')[0];
  const saved = await api('PUT', '/api/config', { title: 'Tests', categories: [], widgets: WIDGETS });
  assert.equal(saved.status, 200, saved.text);
});

after(() => {
  for (const child of children) child.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

const widget = async (id) => {
  const r = await api('GET', `/api/widgets/${id}`);
  assert.equal(r.status, 200, `${id} : ${r.text}`);
  return r.json;
};

// ---------- Données de chaque widget ----------
test('Jellyfin : compteurs et lectures en cours', async () => {
  const d = await widget('jellyfin');
  assert.deepEqual(d.stats.map((s) => s.key), ['movies', 'series', 'episodes']);
  assert.ok(d.sessions.length > 0 && d.sessions.every((s) => s.title && typeof s.progress === 'number'));
});

test('Plex : bibliothèques et lectures en cours', async () => {
  const d = await widget('plex');
  assert.deepEqual(d.stats, [{ key: 'libraries', value: 3 }, { key: 'streams', value: 2 }]);
  assert.deepEqual(d.sessions.map((s) => [s.title, s.paused]), [['Severance — S02E04', false], ['Dune: Part Two', true]]);
  assert.equal(d.sessions[1].subtitle, '2024');
  assert.ok(Math.abs(d.sessions[0].progress - 31 / 47) < 1e-9);
});

test('qBittorrent : débits et torrents', async () => {
  const d = await widget('qbittorrent');
  assert.equal(typeof d.download, 'number');
  assert.ok(d.torrents.length > 0 && d.torrents[0].group === 'downloading', 'téléchargements actifs en premier');
});

test('Sonarr et Radarr : à venir et file d’attente', async () => {
  for (const id of ['sonarr', 'radarr']) {
    const d = await widget(id);
    assert.ok(Array.isArray(d.upcoming) && d.upcoming.length > 0, id);
    assert.equal(typeof d.queue.total, 'number', id);
  }
});

test('Proxmox VE : nœuds, VM et stockages', async () => {
  const d = await widget('proxmox');
  assert.ok(d.nodes.length > 0 && d.guests.length > 0);
  assert.equal(d.running, d.guests.filter((g) => g.running).length);
});

test('Pulse : les trois blocs par défaut', async () => {
  const d = await widget('pulse');
  assert.deepEqual(d.sections, ['health', 'alerts', 'resources']);
  assert.ok(d.health && Array.isArray(d.alerts) && Array.isArray(d.resources));
});

test('Météo : conditions actuelles et 5 jours', async () => {
  const d = await widget('weather');
  assert.equal(d.place.name, 'Nantes');
  assert.equal(typeof d.current.temp, 'number');
  assert.equal(d.days.length, 5);
});

test('Immich : photos, vidéos et utilisateurs', async () => {
  const d = await widget('immich');
  assert.ok(d.photos > 0 && d.users.length > 1);
});

test('Pi-hole et AdGuard Home : format commun', async () => {
  for (const id of ['pihole', 'adguard']) {
    const d = await widget(id);
    assert.ok(['enabled', 'disabled', 'failed', 'unknown'].includes(d.protection), id);
    assert.ok(d.queries >= d.blocked, id);
  }
});

test('Uptime Kuma : sondes de la page de statut, en panne d’abord', async () => {
  const d = await widget('kuma');
  assert.deepEqual([d.title, d.up, d.down, d.total], ['Maison', 2, 1, 5], 'sonde présente dans deux groupes comptée une fois');
  assert.deepEqual(d.monitors.map((m) => m.status), ['down', 'pending', 'maintenance', 'up', 'up']);
  assert.match(d.monitors[0].message, /ECONNREFUSED/);
  assert.equal(d.monitors.find((m) => m.name === 'Jellyfin').ping, 42);
  // Adresse de la page collée dans l'URL : URL et nom en sont tirés.
  const saved = (await api('GET', '/api/config')).json.widgets.find((w) => w.id === 'kuma-pasted');
  assert.deepEqual([saved.url, saved.slug], ['http://localhost:13001', 'maison']);
  assert.equal((await widget('kuma-pasted')).total, 5);
});

test('Glances : une autre machine, API v4 ou v3', async () => {
  const pc = await widget('glances-pc');
  assert.deepEqual([pc.version, pc.hostname, pc.uptime], ['4', 'pc-bureau', 3 * 86400 + 4 * 3600 + 5 * 60 + 6]);
  assert.deepEqual(pc.disks.map((d) => d.mount), ['C:\\', 'D:\\']);
  assert.deepEqual(pc.temp, { value: 67, label: 'GPU' }, '°F converti, ventilateur ignoré');
  const pi = await widget('glances-pi');
  assert.deepEqual([pi.version, pi.hostname, pi.cpu], ['3', 'raspberrypi', 88.2]);
  assert.deepEqual(pi.disks.map((d) => d.mount), ['/'], 'même disque monté deux fois : point de montage le plus court ; squashfs écarté');
  assert.equal(pi.temp, null, 'plugin sensors absent');
});

test('Glances : version revérifiée, machine éteinte sondée une fois', async () => {
  // Appel direct de l'intégration, sans le cache des widgets du serveur.
  const { fetch: fetchGlances } = require('../integrations').INTEGRATIONS.glances;
  const pi = { id: 'gl-direct', type: 'glances', url: 'http://localhost:61209', password: 'glances-pass' };
  assert.equal((await fetchGlances(pi)).version, '3');
  await fetch('http://localhost:61209/__version', { method: 'POST' }); // Glances mis à jour : API v4
  try {
    const d = await fetchGlances(pi);
    assert.deepEqual([d.version, d.hostname], ['4', 'raspberrypi']);
  } finally {
    await fetch('http://localhost:61209/__version', { method: 'POST' });
  }
  // Machine qui coupe toutes les connexions : un seul essai, l'erreur est retenue 30 s.
  let connections = 0;
  const server = require('node:net').createServer((s) => { connections++; s.destroy(); });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const off = { id: 'gl-off', type: 'glances', url: `http://localhost:${server.address().port}` };
    for (let i = 0; i < 3; i++) await assert.rejects(fetchGlances(off), { key: 'glances_offline' });
    assert.equal(connections, 1);
  } finally {
    server.close();
  }
});

test('Frigate : caméras, événements et miniatures via le dashboard', async () => {
  for (const id of ['frigate', 'frigate-auth']) {
    const d = await widget(id);
    assert.deepEqual(d.cameras.map((c) => [c.name, c.online]), [['entree', true], ['garage', false], ['jardin', true]], id);
    assert.equal(d.inference, 8.47);
    assert.deepEqual(d.events.map((e) => e.label), ['Thomas', 'cat', 'package', 'AB-123-CD', 'dog'], 'sub_label (tableau ou texte) prioritaire');
    assert.equal(d.events[0].ongoing, true);
    const img = await fetch(`${BASE}/api/widgets/${id}/thumbnail/${encodeURIComponent(d.events[0].id)}`);
    assert.equal(img.status, 200, id);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.match(img.headers.get('cache-control'), /private/);
    assert.equal((await img.arrayBuffer()).byteLength > 100, true);
  }
  // Pas de miniature, identifiant suspect, widget sans miniatures : 404.
  // Chemin envoyé tel quel (fetch remplacerait « /.. » avant l'envoi, comme un navigateur).
  const rawStatus = (url) => new Promise((resolve, reject) => {
    require('node:http').get({ host: 'localhost', port: PORT, path: url }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  for (const url of ['/api/widgets/frigate/thumbnail/sans-miniature', '/api/widgets/frigate/thumbnail/..%2F..%2Fapi%2Fconfig',
    '/api/widgets/frigate/thumbnail/..', '/api/widgets/frigate/thumbnail/.', '/api/widgets/frigate/thumbnail/%2E%2E',
    '/api/widgets/jellyfin/thumbnail/x', '/api/widgets/inconnu/thumbnail/x']) {
    assert.equal(await rawStatus(url), 404, url);
  }
});

test('Home Assistant : entités choisies, introuvable signalée sans erreur', async () => {
  const d = await widget('ha');
  assert.deepEqual(d.entities.map((e) => e.id), ['sensor.salon_temperature', 'binary_sensor.porte_entree', 'binary_sensor.mouvement_couloir', 'light.salon', 'person.thomas', 'sensor.cave_humidite', 'sensor.supprime'], 'ordre gardé, doublon retiré');
  const temp = d.entities[0];
  assert.deepEqual([temp.name, temp.state, temp.unit], ['Salon', '21.456', '°C']);
  assert.equal(d.entities[1].deviceClass, 'door');
  assert.equal(d.entities.at(-1).missing, true);
});

test('Home Assistant : entités invalides refusées', async () => {
  const cfg = (await api('GET', '/api/config')).json;
  for (const [entities, code] of [['pas une entité', 'ha_entity_invalid'], ['', 'ha_entities_missing'],
    [Array.from({ length: 31 }, (_, i) => `sensor.s${i}`), 'ha_too_many']]) {
    const r = await api('PUT', '/api/config', { ...cfg, widgets: [...cfg.widgets, { type: 'homeassistant', url: 'http://localhost:18123', entities }] });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json.code, code);
  }
});

test('Nginx Proxy Manager : hôtes et certificats', async () => {
  const d = await widget('npm');
  assert.deepEqual(d.hosts, { enabled: 6, disabled: 1 }, 'enabled : true ou 1');
  assert.equal(d.expiring, 2, 'expiré + dans 5 jours');
  assert.deepEqual(d.certificates.map((c) => c.expired), [true, false, false, false], 'triés par expiration');
  assert.equal(d.certificates[1].days, 5, 'jours entamés');
  assert.equal(d.certificates[1].name, 'ha.maison.fr', 'sans nom : premier domaine');
});

test('GitHub : version, issues, PR (dépôt donné par son adresse)', async () => {
  const d = await widget('github');
  assert.equal(d.repo.name, 'circule-studio/server-dashboard');
  assert.equal(d.version.latest.tag, 'v0.8.0', 'la pré-release n’est pas la dernière version');
  assert.equal(d.version.prerelease.tag, 'v0.9.0-beta.1');
  assert.equal(typeof d.version.unreleased, 'number');
  assert.ok(d.issues.total > 0 && d.pulls.items.some((p) => p.draft));
  const cfg = await api('GET', '/api/config');
  const saved = cfg.json.widgets.find((w) => w.id === 'github');
  assert.equal(saved.repo, 'circule-studio/server-dashboard', 'dépôt normalisé');
  assert.equal(saved.name, 'circule-studio/server-dashboard', 'nom par défaut');
});

// ---------- Erreurs ----------
test('Erreurs : un code traduisible pour chaque cas', async () => {
  const expected = {
    'jellyfin-bad': 'auth_refused',
    'plex-bad': 'auth_refused',
    'qbit-bad': 'qbit_credentials',
    'immich-user': 'immich_admin',
    'pihole-bad': 'pihole_password',
    'adguard-bad': 'adguard_credentials',
    'weather-unknown': 'location_not_found',
    'npm-bad': 'npm_credentials',
    'ha-bad': 'auth_refused',
    'kuma-missing': 'kuma_not_found',
    'glances-bad': 'glances_credentials',
    'glances-off': 'glances_offline',
    'frigate-noauth': 'frigate_auth_required',
    'frigate-bad': 'frigate_credentials',
    'github-private': 'github_not_found',
    'github-limit': 'github_rate_limit',
    unreachable: 'unreachable',
  };
  const i18n = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');
  for (const [id, code] of Object.entries(expected)) {
    const r = await api('GET', `/api/widgets/${id}`);
    assert.equal(r.status, 502, `${id} : ${r.text}`);
    assert.equal(r.json.code, code, id);
    assert.ok(i18n.includes(`'err.${code}'`), `err.${code} traduit`);
  }
});

test('Connexion refusée : pas de nouvelle tentative à chaque rafraîchissement', async () => {
  const before = (await (await fetch('http://localhost:18971/__logins')).json()).count;
  for (let i = 0; i < 3; i++) {
    const r = await api('GET', '/api/widgets/frigate-bad');
    assert.equal(r.json.code, 'frigate_credentials');
  }
  const after = (await (await fetch('http://localhost:18971/__logins')).json()).count;
  assert.ok(after - before <= 1, `${after - before} tentatives au lieu d'une au plus`);
});

test('Widget inconnu : 404', async () => {
  const r = await api('GET', '/api/widgets/nexiste-pas');
  assert.equal(r.status, 404);
});

test('Config invalide refusée avec un code', async () => {
  for (const [w, code] of [[{ type: 'github', repo: '../x' }, 'github_repo_invalid'],
    [{ type: 'npm', url: 'http://localhost:10081', username: '' }, 'username_required'],
    [{ type: 'proxmox', url: 'http://localhost:18006' }, 'username_required'],
    [{ type: 'uptimekuma', url: 'http://localhost:13001' }, 'kuma_slug_invalid'],
    [{ type: 'uptimekuma', url: 'http://localhost:13001', slug: '../x' }, 'kuma_slug_invalid']]) {
    const r = await api('PUT', '/api/config', { title: 'x', categories: [], widgets: [w] });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json.code, code);
  }
});

test('Taille des tuiles : invalide ou absente = inchangée', async () => {
  const cfg = (await api('GET', '/api/config')).json;
  let r = await api('PUT', '/api/config', { ...cfg, tileSize: 'large' });
  assert.equal(r.json.tileSize, 'large');
  r = await api('PUT', '/api/config', { ...r.json, tileSize: 'énorme' });
  assert.equal(r.json.tileSize, 'large');
  const { tileSize, ...rest } = r.json;
  r = await api('PUT', '/api/config', rest);
  assert.equal(r.json.tileSize, 'large');
});

// ---------- Secrets ----------
test('Aucun secret dans /api/config (connecté ou non)', async () => {
  const authed = await api('GET', '/api/config');
  const saved = cookie;
  cookie = '';
  const visitor = await api('GET', '/api/config');
  cookie = saved;
  for (const r of [authed, visitor]) {
    assert.equal(r.status, 200);
    for (const s of SECRETS) assert.ok(!r.text.includes(`"${s}"`), `secret « ${s} » envoyé au navigateur`);
  }
  assert.equal(authed.json.widgets.find((w) => w.id === 'jellyfin').hasApiKey, true);
  assert.ok(!('username' in visitor.json.widgets.find((w) => w.id === 'qbittorrent')), 'utilisateur caché aux visiteurs');
});

test('Un champ secret vide garde la valeur enregistrée', async () => {
  const cfg = (await api('GET', '/api/config')).json;
  const r = await api('PUT', '/api/config', { ...cfg, widgets: cfg.widgets.map((w) => ({ ...w, apiKey: '', password: '' })) });
  assert.equal(r.status, 200, r.text);
  await widget('jellyfin'); // la clé jf-key est toujours là
});

// ---------- Sauvegarde ----------
test('Export de la config : admin seulement, sans secrets par défaut, réimportable', async () => {
  const saved = cookie;
  cookie = '';
  assert.equal((await api('GET', '/api/config/export')).status, 401);
  cookie = saved;
  const plain = await api('GET', '/api/config/export');
  assert.equal(plain.status, 200);
  assert.match(plain.headers.get('content-disposition'), /attachment; filename="server-dashboard-\d{4}-\d{2}-\d{2}\.json"/);
  assert.equal(plain.json.format, 'server-dashboard-config');
  assert.equal(plain.json.secrets, false);
  for (const s of SECRETS) assert.ok(!plain.text.includes(`"${s}"`), `secret « ${s} » dans l'export sans secrets`);
  assert.equal(plain.json.config.widgets.find((w) => w.id === 'qbittorrent').username, 'admin', 'utilisateur gardé');
  const full = await api('GET', '/api/config/export?secrets=1');
  assert.equal(full.json.secrets, true);
  assert.equal(full.json.config.widgets.find((w) => w.id === 'jellyfin').apiKey, 'jf-key');
  // Réimport, comme le fait l'interface : la config enregistrée reste identique.
  const before = (await api('GET', '/api/config')).json;
  for (const exported of [plain.json, full.json]) {
    const current = (await api('GET', '/api/config')).json;
    const r = await api('PUT', '/api/config', { ...exported.config, revision: current.revision });
    assert.equal(r.status, 200, r.text);
    const { revision, ...after } = r.json;
    const { revision: _, ...expected } = before;
    assert.deepEqual(after, expected);
  }
  await widget('jellyfin'); // la clé est toujours là après l'import sans secrets
});

// ---------- Notifications ----------
const listen = (server, port = 0) => new Promise((resolve) => server.listen(port, () => resolve(server.address().port)));
async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

test('Notifications : une app qui tombe puis revient, deux notifications', async () => {
  const http = require('node:http');
  const received = [];
  const hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => { received.push({ path: req.url, headers: req.headers, body: JSON.parse(body) }); res.end('ok'); });
  });
  const hookPort = await listen(hook);
  const app = () => http.createServer((req, res) => res.end('ok'));
  let target = app();
  const targetPort = await listen(target);
  const cfg = (await api('GET', '/api/config')).json;
  const notify = { type: 'webhook', url: `http://localhost:${hookPort}/hook`, token: 'hook-token', lang: 'fr' };
  try {
    let r = await api('PUT', '/api/config', {
      ...cfg, notify,
      categories: [...cfg.categories, { id: 'cat-notif', name: 'Surveillées', apps: [{ id: 'app-cible', name: 'Cible', url: `http://localhost:${targetPort}` }] }],
    });
    assert.equal(r.status, 200, r.text);
    // Réglage visible de l'admin, sans l'URL ni le jeton ; rien dans l'export sans secrets.
    assert.deepEqual(r.json.notify, { type: 'webhook', lang: 'fr', hasUrl: true, hasToken: true });
    for (const res of [r, await api('GET', '/api/config/export')]) {
      assert.ok(!res.text.includes('hook-token') && !res.text.includes(`:${hookPort}`), 'secret de notification envoyé au navigateur');
    }
    await new Promise((res) => setTimeout(res, 700)); // plusieurs vérifications : l'app est en ligne
    assert.equal(received.length, 0, 'pas de notification au démarrage');

    target.close();
    target.closeAllConnections();
    assert.ok(await until(() => received.length === 1), 'notification « hors ligne »');
    assert.deepEqual([received[0].body.event, received[0].body.title, received[0].body.app.name], ['down', '🔴 Cible est hors ligne', 'Cible']);
    assert.equal(received[0].headers.authorization, 'Bearer hook-token');

    target = app();
    await listen(target, targetPort);
    assert.ok(await until(() => received.length === 2), 'notification « de nouveau en ligne »');
    assert.equal(received[1].body.event, 'up');
    await new Promise((res) => setTimeout(res, 700));
    assert.equal(received.length, 2, 'une seule notification par changement');

    // Bouton de test : réglages enregistrés, puis chaque format, sans les enregistrer.
    r = await api('POST', '/api/notify/test', { type: 'webhook', lang: 'en' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([received[2].body.event, received[2].body.title], ['test', '✅ Test notification']);
    await api('POST', '/api/notify/test', { type: 'ntfy', url: `http://localhost:${hookPort}/mon-sujet?x=1#y`, token: 'tk_x' });
    assert.deepEqual([received[3].path, received[3].body.topic, received[3].headers.authorization], ['/', 'mon-sujet', 'Bearer tk_x']);
    await api('POST', '/api/notify/test', { type: 'gotify', url: `http://localhost:${hookPort}/`, token: 'gotify-app' });
    assert.deepEqual([received[4].path, received[4].headers['x-gotify-key']], ['/message', 'gotify-app']);
    await api('POST', '/api/notify/test', { type: 'discord', url: `http://localhost:${hookPort}/api/webhooks/1/abc` });
    assert.match(received[5].body.content, /^\*\*✅ Notification de test\*\*/);
    // Erreurs traduites
    for (const [body, code] of [[{ type: 'ntfy', url: 'https://ntfy.sh' }, 'notify_topic_missing'],
      [{ type: 'gotify', url: `http://localhost:${hookPort}` }, 'notify_token_missing'], [{}, 'notify_missing'],
      [{ type: 'discord', url: 'http://' }, 'invalid_url']]) {
      const res = await api('POST', '/api/notify/test', body);
      assert.deepEqual([res.status, res.json.code], [400, code]);
    }
  } finally {
    const now = (await api('GET', '/api/config')).json;
    await api('PUT', '/api/config', { ...now, notify: { type: '' }, categories: now.categories.filter((c) => c.id !== 'cat-notif') });
    target.close();
    target.closeAllConnections();
    hook.close();
  }
});

test('Notifications : suivi des changements d’état (module seul)', () => {
  const { createMonitor } = require('../notify');
  const apps = [{ id: 'a', name: 'A', url: 'http://a' }];
  const step = (m, online) => m.update(apps, { a: { online } }).map((e) => e.kind);
  // Hors ligne dès la première vérification : ni alerte, ni « retour » quand elle revient.
  let m = createMonitor();
  assert.deepEqual([step(m, false), step(m, false), step(m, true)], [[], [], []]);
  // En ligne, puis deux échecs : une alerte ; un seul échec : rien.
  m = createMonitor();
  assert.deepEqual([step(m, true), step(m, false), step(m, true), step(m, false), step(m, false), step(m, false), step(m, true)],
    [[], [], [], [], ['down'], [], ['up']]);
  // Envoi impossible : l'alerte repart à la vérification suivante.
  m = createMonitor();
  step(m, true); step(m, false);
  const [event] = m.update(apps, { a: { online: false } });
  m.failed(event);
  assert.deepEqual(step(m, false), ['down']);
});

test('Un secret ne passe pas d’un type de widget à un autre', async () => {
  const cfg = (await api('GET', '/api/config')).json;
  const r = await api('PUT', '/api/config', { ...cfg, widgets: cfg.widgets.map((w) => (w.id === 'sonarr' ? { ...w, type: 'radarr', apiKey: '' } : w)) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.widgets.find((w) => w.id === 'sonarr').hasApiKey, false, 'clé Sonarr gardée pour un Radarr');
  await api('PUT', '/api/config', { ...r.json, widgets: r.json.widgets.map((w) => (w.id === 'sonarr' ? { ...w, type: 'sonarr', apiKey: 'sonarr-key' } : w)) });
});

// ---------- Démarrage ----------
test('Port déjà utilisé : erreur claire et code de sortie 1', async () => {
  // Le port des tests est occupé par le dashboard lancé dans before().
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: PASSWORD } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 1, out);
  assert.match(out, /déjà utilisé/);
  assert.doesNotMatch(out, /Server Dashboard sur/);
});

// ---------- Docker ----------
test('Docker : conteneurs du faux socket', { skip: process.platform === 'win32' && 'socket unix' }, async () => {
  const r = await api('GET', '/api/docker/containers');
  assert.equal(r.json.available, true, r.text);
  assert.ok(r.json.containers.some((c) => c.name === 'jellyfin'));
});
