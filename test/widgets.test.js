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
  { id: 'qbittorrent', type: 'qbittorrent', url: 'http://localhost:18080', username: 'admin', password: 'secret' },
  { id: 'sonarr', type: 'sonarr', url: 'http://localhost:18989', apiKey: 'sonarr-key' },
  { id: 'radarr', type: 'radarr', url: 'http://localhost:17878', apiKey: 'radarr-key' },
  { id: 'proxmox', type: 'proxmox', url: 'http://localhost:18006', username: 'root@pam!dashboard', apiKey: 'pve-secret' },
  { id: 'pulse', type: 'pulse', url: 'http://localhost:17655', apiKey: 'pulse-token' },
  { id: 'weather', type: 'weather', url: 'http://localhost:18765', location: 'Nantes' },
  { id: 'immich', type: 'immich', url: 'http://localhost:12283', apiKey: 'immich-key' },
  { id: 'pihole', type: 'pihole', url: 'http://localhost:10080', password: 'pihole-pass' },
  { id: 'adguard', type: 'adguard', url: 'http://localhost:13000', username: 'admin', password: 'adguard-pass' },
  { id: 'frigate', type: 'frigate', url: 'http://localhost:15000' },
  { id: 'frigate-auth', type: 'frigate', url: 'http://localhost:18971', username: 'viewer', password: 'frigate-pass' },
  { id: 'ha', type: 'homeassistant', url: 'http://localhost:18123', apiKey: 'ha-token', entities: 'sensor.salon_temperature, binary_sensor.porte_entree\nbinary_sensor.mouvement_couloir light.salon person.thomas sensor.cave_humidite sensor.supprime sensor.salon_temperature' },
  { id: 'npm', type: 'npm', url: 'http://localhost:10081', username: 'admin@example.com', password: 'npm-pass' },
  { id: 'github', type: 'github', url: 'http://localhost:14000', repo: 'https://github.com/circule-studio/server-dashboard' },
  // Cas d'erreur : chacun doit renvoyer un code que l'interface traduit.
  { id: 'jellyfin-bad', type: 'jellyfin', url: 'http://localhost:18096', apiKey: 'mauvaise-cle' },
  { id: 'qbit-bad', type: 'qbittorrent', url: 'http://localhost:18080', username: 'admin', password: 'faux' },
  { id: 'immich-user', type: 'immich', url: 'http://localhost:12283', apiKey: 'immich-user-key' },
  { id: 'pihole-bad', type: 'pihole', url: 'http://localhost:10080', password: 'faux' },
  { id: 'adguard-bad', type: 'adguard', url: 'http://localhost:13000', username: 'admin', password: 'faux' },
  { id: 'weather-unknown', type: 'weather', url: 'http://localhost:18765', location: 'Ville qui n’existe pas' },
  { id: 'frigate-noauth', type: 'frigate', url: 'http://localhost:18971' },
  { id: 'frigate-bad', type: 'frigate', url: 'http://localhost:18971', username: 'viewer', password: 'faux' },
  { id: 'ha-bad', type: 'homeassistant', url: 'http://localhost:18123', apiKey: 'mauvais-jeton', entities: ['light.salon'] },
  { id: 'npm-bad', type: 'npm', url: 'http://localhost:10081', username: 'admin@example.com', password: 'faux' },
  { id: 'github-private', type: 'github', url: 'http://localhost:14000', repo: 'demo/private' },
  { id: 'github-limit', type: 'github', url: 'http://localhost:14000', repo: 'demo/rate-limited' },
  { id: 'unreachable', type: 'sonarr', url: 'http://localhost:9', apiKey: 'x' },
];
const SECRETS = ['jf-key', 'secret', 'sonarr-key', 'radarr-key', 'pve-secret', 'pulse-token', 'immich-key', 'pihole-pass', 'adguard-pass', 'mauvaise-cle', 'immich-user-key', 'npm-pass', 'ha-token', 'mauvais-jeton', 'frigate-pass'];

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-test-'));
  await start('dev/mocks.js', {}, 'mocks prêts');
  await start('server.js', { PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: PASSWORD, DOCKER_SOCKET }, 'Server Dashboard sur');
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
  for (const url of ['/api/widgets/frigate/thumbnail/sans-miniature', '/api/widgets/frigate/thumbnail/..%2F..%2Fapi%2Fconfig',
    '/api/widgets/jellyfin/thumbnail/x', '/api/widgets/inconnu/thumbnail/x']) {
    assert.equal((await fetch(BASE + url)).status, 404, url);
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
    'qbit-bad': 'qbit_credentials',
    'immich-user': 'immich_admin',
    'pihole-bad': 'pihole_password',
    'adguard-bad': 'adguard_credentials',
    'weather-unknown': 'location_not_found',
    'npm-bad': 'npm_credentials',
    'ha-bad': 'auth_refused',
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

test('Widget inconnu : 404', async () => {
  const r = await api('GET', '/api/widgets/nexiste-pas');
  assert.equal(r.status, 404);
});

test('Config invalide refusée avec un code', async () => {
  const r = await api('PUT', '/api/config', { title: 'x', categories: [], widgets: [{ type: 'github', repo: '../x' }] });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'github_repo_invalid');
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

// ---------- Docker ----------
test('Docker : conteneurs du faux socket', { skip: process.platform === 'win32' && 'socket unix' }, async () => {
  const r = await api('GET', '/api/docker/containers');
  assert.equal(r.json.available, true, r.text);
  assert.ok(r.json.containers.some((c) => c.name === 'jellyfin'));
});
