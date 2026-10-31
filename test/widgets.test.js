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
  { id: 'pbs', type: 'pbs', url: 'http://localhost:18007', username: 'root@pam!dashboard', apiKey: 'pbs-secret' },
  { id: 'pbs-bad', type: 'pbs', url: 'http://localhost:18007', username: 'root@pam!dashboard', apiKey: 'faux' },
  { id: 'speedtest', type: 'speedtest', url: 'http://localhost:18766', apiKey: 'speedtest-token' },
  { id: 'speedtest-v0', type: 'speedtest', url: 'http://localhost:18766' },
  { id: 'speedtest-bad', type: 'speedtest', url: 'http://localhost:18766', apiKey: 'faux' },
  { id: 'scrutiny', type: 'scrutiny', url: 'http://localhost:18580' },
  { id: 'lidarr', type: 'lidarr', url: 'http://localhost:18686', apiKey: 'lidarr-key' },
  { id: 'readarr', type: 'readarr', url: 'http://localhost:18787', apiKey: 'readarr-key' },
  { id: 'prowlarr', type: 'prowlarr', url: 'http://localhost:19696', apiKey: 'prowlarr-key' },
  { id: 'bazarr', type: 'bazarr', url: 'http://localhost:16767', apiKey: 'bazarr-key' },
  { id: 'bazarr-bad', type: 'bazarr', url: 'http://localhost:16767', apiKey: 'faux' },
  { id: 'proxmox', type: 'proxmox', url: 'http://localhost:18006', username: 'root@pam!dashboard', apiKey: 'pve-secret' },
  { id: 'pulse', type: 'pulse', url: 'http://localhost:17655', apiKey: 'pulse-token' },
  { id: 'weather', type: 'weather', url: 'http://localhost:18765', location: 'Nantes' },
  { id: 'immich', type: 'immich', url: 'http://localhost:12283', apiKey: 'immich-key' },
  { id: 'pihole', type: 'pihole', url: 'http://localhost:10080', password: 'pihole-pass' },
  { id: 'adguard', type: 'adguard', url: 'http://localhost:13000', username: 'admin', password: 'adguard-pass' },
  { id: 'agent', type: 'agent', name: 'PC de bureau' },
  { id: 'alwaysdata', type: 'alwaysdata', url: 'http://localhost:17443/v1', username: 'thomas', apiKey: 'alwaysdata-token' },
  { id: 'alwaysdata-bad', type: 'alwaysdata', url: 'http://localhost:17443/v1', apiKey: 'mauvais-jeton-ad' },
  { id: 'alwaysdata-ip', type: 'alwaysdata', url: 'http://localhost:17443/v1', apiKey: 'alwaysdata-ip-token' },
  { id: 'ical', type: 'ical', apiKey: 'http://localhost:18091/agenda.ics http://localhost:18091/prive.ics', username: 'agenda', password: 'agenda-pass' },
  { id: 'ical-bad', type: 'ical', apiKey: 'http://localhost:18091/pas-ical' },
  { id: 'ical-auth', type: 'ical', apiKey: 'http://localhost:18091/prive.ics', username: 'agenda', password: 'faux' },
  { id: 'crowdsec', type: 'crowdsec', url: 'http://localhost:18093', username: 'dashboard', password: 'crowdsec-pass' },
  { id: 'crowdsec-key', type: 'crowdsec', url: 'http://localhost:18093', apiKey: 'crowdsec-bouncer' },
  { id: 'crowdsec-bad', type: 'crowdsec', url: 'http://localhost:18093', username: 'dashboard', password: 'faux' },
  { id: 'crowdsec-badkey', type: 'crowdsec', url: 'http://localhost:18093', apiKey: 'fausse-cle' },
  { id: 'traefik', type: 'traefik', url: 'http://localhost:18094' },
  { id: 'traefik-auth', type: 'traefik', url: 'http://localhost:18098', username: 'traefik', password: 'traefik-pass' },
  { id: 'traefik-bad', type: 'traefik', url: 'http://localhost:18098', username: 'traefik', password: 'faux' },
  { id: 'wazuh', type: 'wazuh', url: 'http://localhost:18095', username: 'wazuh-wui', password: 'wazuh-pass', indexerUrl: 'http://localhost:18097', apiKey: 'admin:indexer-pass' },
  { id: 'wazuh-noindex', type: 'wazuh', url: 'http://localhost:18095', username: 'wazuh-wui', password: 'wazuh-pass' },
  { id: 'wazuh-bad', type: 'wazuh', url: 'http://localhost:18095', username: 'wazuh-wui', password: 'faux' },
  { id: 'rss', type: 'rss', feeds: ['http://localhost:18090/rss.xml', 'http://localhost:18090/atom.xml', 'http://localhost:9/flux'] },
  { id: 'rss-bad', type: 'rss', feeds: ['http://localhost:18090/pas-un-flux'] },
  { id: 'goaccess', type: 'goaccess', url: 'http://localhost:17890/summary.json' },
  { id: 'goaccess-bad', type: 'goaccess', url: 'http://localhost:17890/pas-un-rapport' },
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
  // API personnalisée : en-tête, Basic, mauvaise clé, réponse qui n'est pas du JSON.
  {
    id: 'customapi', type: 'customapi', url: 'http://localhost:18092/prive', apiKey: 'X-Api-Key: custom-key',
    mappings: 'data.users.count | Utilisateurs | nombre\ndata.storage.percent | Stockage | pourcentage\n\ndata.items.0.name | Dernière\n'
      + 'data.items.length | Tâches | number\ndata.manquant | Absent\ndata.__proto__ | Piège\ndata.online | En ligne\ndata.updated | Mise à jour | date',
  },
  { id: 'customapi-basic', type: 'customapi', url: 'http://localhost:18092/prive', username: 'api', password: 'api-pass', mappings: [{ path: 'data.speed', label: 'Débit', format: 'rate' }] },
  { id: 'customapi-bad', type: 'customapi', url: 'http://localhost:18092/prive', apiKey: 'mauvaise-cle-api', mappings: 'data.users.count' },
  { id: 'customapi-text', type: 'customapi', url: 'http://localhost:18092/texte', mappings: 'data.users.count' },
];
const SECRETS = ['traefik-pass', 'wazuh-pass', 'indexer-pass', 'crowdsec-pass', 'crowdsec-bouncer', 'speedtest-token', 'pbs-secret', 'lidarr-key', 'readarr-key', 'prowlarr-key', 'bazarr-key', 'custom-key', 'api-pass', 'mauvaise-cle-api', 'agenda-pass', 'localhost:18091/agenda.ics', 'alwaysdata-token', 'mauvais-jeton-ad', 'alwaysdata-ip-token', 'jf-key', 'secret', 'sonarr-key', 'radarr-key', 'pve-secret', 'pulse-token', 'immich-key', 'pihole-pass', 'adguard-pass', 'mauvaise-cle', 'immich-user-key', 'npm-pass', 'ha-token', 'mauvais-jeton', 'frigate-pass', 'glances-pass', 'plex-token', 'mauvais-token'];

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

test('Lidarr et Readarr : à venir (artiste, auteur, déjà disponible) et file d’attente', async () => {
  const l = await widget('lidarr');
  assert.deepEqual(l.upcoming.map((e) => [e.title, e.subtitle, e.hasFile]), [
    ['Moon Music', 'Coldplay', true], ['Hit Me Hard and Soft (Deluxe)', 'Billie Eilish', false],
  ], 'triés par date');
  assert.equal(l.queue.total, 2);
  const r = await widget('readarr');
  assert.deepEqual(r.upcoming.map((e) => e.subtitle), ['Giuliano da Empoli']);
});

test('Prowlarr : indexeurs actifs, en pause, statistiques', async () => {
  const d = await widget('prowlarr');
  assert.deepEqual([d.enabled, d.queries, d.grabs], [3, 1925, 99]);
  assert.deepEqual(d.failing.map((f) => f.name), ['1337x'], 'une pause terminée ne compte plus');
});

test('Proxmox Backup Server : datastores, tâches en échec, alertes', async () => {
  const d = await widget('pbs');
  assert.deepEqual(d.datastores.map((s) => s.name), ['sauvegardes', 'externe'], 'datastore en erreur écarté');
  assert.deepEqual(d.backups, { ok: 2, failed: 1 }, 'avertissements comptés comme réussis, tâche en cours ignorée');
  assert.equal(d.tasks, 5);
  assert.deepEqual(d.failed.map((f) => [f.type, f.id, f.error]), [['backup', 'externe:ct/101', 'backup failed: no space left on device']]);
  assert.deepEqual([d.cpu, d.mem.total > 0, d.uptime], [0.12, true, 864000]);
  const { INTEGRATIONS } = require('../integrations');
  const alerts = INTEGRATIONS.pbs.alerts(d, { id: 'pbs', name: 'PBS', url: 'http://pbs' });
  assert.deepEqual(alerts.map((a) => [a.id, a.problem, a.online, a.value]), [
    ['pbs:tasks', 'backup', false, 1], ['pbs:disk:sauvegardes', 'disk', true, 62], ['pbs:disk:externe', 'disk', false, 94],
  ]);
});

test('Scrutiny : disques, échec SMART en premier, alertes', async () => {
  const d = await widget('scrutiny');
  assert.deepEqual(d.disks.map((x) => [x.name, x.failed, x.temp]), [['sdb', true, 57], ['sda', false, 34], ['sdc', false, 38]], 'disque archivé ignoré');
  assert.equal(d.failed, 1);
  const { INTEGRATIONS } = require('../integrations');
  const a = INTEGRATIONS.scrutiny.alerts(d, { id: 's', name: 'NAS', url: 'http://nas' });
  assert.deepEqual(a.map((x) => [x.id, x.problem, x.online]), [['s:smart:0x5000cca2b3c4d5e6', 'smart', false], ['s:smart:0x5000c500a1b2c3d4', 'smart', true], ['s:smart:0x50014ee2c3d4e5f6', 'smart', true]]);
  assert.equal(a[0].name, 'NAS · sdb (WDC WD40EFRX-68N32N0)');
});

test('Speedtest Tracker : dernier test, moyenne sur 7 jours, ancienne API', async () => {
  const d = await widget('speedtest');
  assert.deepEqual([d.latest.down, d.latest.up, d.latest.ping], [850, 210, 12], 'bit/s convertis en Mbit/s');
  // 7 jours = 14 tests toutes les 12 h, moins celui en échec.
  assert.equal(d.average.count, 13);
  assert.ok(d.history.length === 12 && d.history.every((r, i) => i === 0 || r.date >= d.history[i - 1].date), '12 derniers, dans l’ordre');
  const v0 = await widget('speedtest-v0');
  assert.deepEqual([v0.latest.down, v0.latest.up, v0.average], [912.5, 230.1, null]);
});

test('Bazarr : sous-titres manquants', async () => {
  assert.deepEqual(await widget('bazarr'), { episodes: 37, movies: 4, providers: 1 });
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
  // Module dl-stats : totaux seulement, jamais les noms ou e-mails des visiteurs.
  assert.deepEqual(d.downloads, { total: 37, images: 35, visitors: 2 });
  assert.ok(!JSON.stringify(d).includes('alice'));
});

test('GoAccess : visiteurs uniques et 7 derniers jours, du plus récent au plus ancien', async () => {
  const d = await widget('goaccess');
  assert.deepEqual([d.visitors, d.requests, d.bandwidth], [312, 14350, 1_850_000_000]);
  assert.equal(d.days.length, 7);
  assert.ok(d.days.every((x, i) => i === 0 || d.days[i - 1].date > x.date));
  assert.equal(d.days[0].visitors, 40, 'aujourd’hui en premier');
});

test('Alwaysdata : sites testés un par un, ceux en panne d’abord', async () => {
  const d = await widget('alwaysdata');
  assert.equal(d.total, 3, 'site sans adresse écarté');
  assert.deepEqual(d.sites.map((s) => [s.online, s.code ?? null]), [[false, 502], [false, null], [true, 200]]);
  assert.equal(d.up, 1);
  assert.equal(d.sites[2].note, 'Blog');
  assert.equal(d.sites[2].scheme, 'http', 'HTTP quand HTTPS échoue');
  assert.ok(!d.sites.some((s) => s.address.startsWith('*')), 'adresse joker ignorée');
});

test('Flux RSS / Atom : articles mélangés par date, texte brut, liens sûrs', async () => {
  const d = await widget('rss');
  assert.equal(d.failed, 1, 'flux injoignable compté');
  assert.deepEqual(d.items.map((i) => i.title), [
    'Proxmox 9 : migration & retour d’expérience'.replace('’', '\''), 'v2.0 — nouveautés', 'Sauvegardes 3-2-1 avec restic', 'v1.9', 'Un vieil article',
  ]);
  assert.deepEqual(d.items.map((i) => i.source), ['Blog du homelab', 'Notes de version', 'Blog du homelab', 'Notes de version', 'Blog du homelab']);
  assert.equal(d.items[1].link, 'https://releases.example.com/v2.0', 'lien rel="alternate"');
  assert.equal(d.items[2].link, '', 'lien javascript: écarté');
  assert.ok(d.items.every((i) => !/[<>]/.test(i.title)), 'aucune balise');
});

test('Flux RSS : adresses invalides refusées à l’enregistrement', async () => {
  const cfg = (await api('GET', '/api/config')).json;
  for (const [feeds, code] of [[[], 'feeds_missing'], [['ftp://x/flux'], 'invalid_url']]) {
    const r = await api('PUT', '/api/config', { ...cfg, widgets: [...cfg.widgets, { id: 'rss-x', type: 'rss', feeds }] });
    assert.deepEqual([r.status, r.json.code], [400, code]);
  }
});

test('Calendrier : deux agendas (dont un protégé), prochains événements', async () => {
  const d = await widget('ical');
  assert.equal(d.calendars, 2);
  assert.equal(d.failed, 0);
  assert.ok(d.events.some((e) => e.title === 'Rendez-vous privé' && e.calendar === 1), 'agenda protégé lu');
  assert.ok(d.events.length <= 10 && d.events.length + d.more >= 9, '10 au plus, le reste compté');
  const when = (e) => (e.allDay ? Date.parse(`${e.start}T00:00:00`) : Date.parse(e.start));
  assert.ok(d.events.every((e, i) => i === 0 || when(d.events[i - 1]) <= when(e)), 'dans l’ordre');
  assert.ok(!d.events.some((e) => e.title === 'Annulé'), 'événement annulé ignoré');
});

test('Calendrier : récurrences, exception, occurrence déplacée, journée entière (module seul)', async () => {
  const { INTEGRATIONS } = require('../integrations');
  const text = await (await fetch('http://localhost:18091/agenda.ics')).text();
  const now = Date.now();
  const events = INTEGRATIONS.ical.parse(text, now, now + 7 * 864e5, 0);
  const day = (n) => new Date(now + n * 864e5).toISOString().slice(0, 10);
  const on = (n, title) => events.filter((e) => e.title === title && e.start.slice(0, 10) === day(n));
  for (const n of [1, 2, 5, 6]) assert.equal(on(n, 'Point quotidien').length, 1, `point quotidien J+${n}`);
  assert.equal(on(3, 'Point quotidien').length, 0, 'EXDATE');
  assert.equal(on(4, 'Point quotidien').length, 0, 'occurrence remplacée');
  assert.equal(on(4, 'Point quotidien (décalé)')[0].start, `${day(4)}T08:00:00.000Z`);
  assert.equal(on(7, 'Point quotidien').length, 0, 'COUNT=10 : fini à J+6');
  assert.equal(events.filter((e) => e.title === 'Sport').length, 1, 'hebdomadaire commencé il y a 300 semaines');
  const bday = events.find((e) => e.title === 'Anniversaire de Camille');
  assert.deepEqual([bday.allDay, bday.start, bday.end], [true, day(2), day(3)]);
  const simple = events.find((e) => e.title === 'Réunion, projet dashboard');
  assert.deepEqual([simple.location, simple.start], ['Salle 2', `${day(1)}T14:00:00.000Z`]);
});

test('CrowdSec : attaques des 24 h (sans CAPI ni simulation), pays, bannis', async () => {
  const d = await widget('crowdsec');
  assert.deepEqual([d.mode, d.alerts24h, d.attackers24h, d.bans.total], ['machine', 4, 4, 3]);
  assert.deepEqual(d.recent.map((a) => a.ip), ['185.220.101.4', '45.148.10.81', '218.92.0.31', '103.152.79.12'], 'plus récentes d’abord');
  assert.deepEqual(d.scenarios[0], { name: 'ssh-bf', count: 2 });
  assert.equal(d.recent[0].country, 'DE');
  assert.equal(d.recent[3].banned, false);
  const b = await widget('crowdsec-key');
  assert.deepEqual([b.mode, b.bans.total, b.recent.length], ['bouncer', 2, 2], 'liste communautaire (CAPI) écartée');
});

test('Traefik : routeurs, services, middlewares, erreurs d’abord', async () => {
  for (const id of ['traefik', 'traefik-auth']) {
    const d = await widget(id);
    assert.deepEqual([d.version, d.routers, d.middlewares.errors], ['3.4.1', { total: 5, warnings: 1, errors: 1 }, 1], id);
    assert.deepEqual(d.problems.map((p) => [p.name, p.status]), [['nextcloud@file', 'error'], ['ha@docker', 'warning']]);
    assert.deepEqual(d.entrypoints.map((e) => e.name), ['web', 'websecure']);
  }
  const { INTEGRATIONS } = require('../integrations');
  const items = INTEGRATIONS.traefik.alerts(await widget('traefik'), { id: 't', name: 'Traefik', url: 'u' });
  assert.deepEqual(items.filter((i) => !i.online).map((i) => i.name), ['Traefik · nextcloud@file', 'Traefik · ha@docker']);
});

test('Wazuh : agents, alertes de l’indexer, sans indexer', async () => {
  const d = await widget('wazuh');
  assert.deepEqual([d.version, d.agents.active, d.agents.disconnected, d.agents.never], ['v4.12.0', 3, 1, 1]);
  assert.deepEqual(d.disconnected.map((a) => a.name), ['nas']);
  assert.deepEqual([d.alerts.high, d.alerts.medium, d.alerts.low, d.alerts.recent.length], [2, 30, 380, 3]);
  const plain = await widget('wazuh-noindex');
  assert.deepEqual([plain.alerts, plain.agents.active], [null, 3], 'sans indexer : seulement les agents');
  const { INTEGRATIONS } = require('../integrations');
  const items = INTEGRATIONS.wazuh.alerts(d, { id: 'z', name: 'Wazuh', url: 'u' });
  assert.deepEqual(items.filter((i) => !i.online).map((i) => i.name), ['Wazuh · nas', 'Wazuh'], 'agent déconnecté et alerte critique');
  assert.ok(!items.some((i) => /manager|portable/.test(i.name)), 'manager et agent jamais connecté ignorés');
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

test('API personnalisée : valeurs choisies, chemins, formats et authentification', async () => {
  const d = await widget('customapi');
  assert.deepEqual(d.values.slice(0, 7).map((v) => [v.label, v.format, v.value]), [
    ['Utilisateurs', 'number', 42], ['Stockage', 'percent', 73.5], ['Dernière', 'text', 'sauvegarde-nuit'],
    ['Tâches', 'number', 2], ['Absent', 'text', null], ['Piège', 'text', null], ['En ligne', 'text', true],
  ]);
  assert.equal(d.values[7].format, 'date');
  assert.ok(Date.now() - Date.parse(d.values[7].value) > 60 * 60_000, 'date telle que renvoyée');
  assert.deepEqual((await widget('customapi-basic')).values, [{ label: 'Débit', format: 'rate', value: 1_250_000 }]);
  // Enregistré sous forme d'objets (ligne vide ignorée, libellé par défaut : vide).
  const saved = (await api('GET', '/api/config')).json.widgets.find((w) => w.id === 'customapi');
  assert.deepEqual(saved.mappings[2], { path: 'data.items.0.name', label: 'Dernière', format: 'text' });
  assert.equal(saved.mappings.length, 8);
});

test('API personnalisée : valeurs invalides refusées à l’enregistrement', async () => {
  const cfg = (await api('GET', '/api/config')).json;
  const many = Array.from({ length: 13 }, (_, i) => `v${i}`).join('\n');
  for (const [mappings, code, params] of [
    ['', 'mappings_missing'], ['a b | x', 'mapping_invalid', { line: 1 }], ['ok\nx | y | inconnu', 'mapping_invalid', { line: 2 }],
    ['a..b', 'mapping_invalid', { line: 1 }], [many, 'mappings_too_many', { max: 12 }],
  ]) {
    const r = await api('PUT', '/api/config', { ...cfg, widgets: [...cfg.widgets, { id: 'api-x', type: 'customapi', url: 'http://localhost:18092/stats', mappings }] });
    assert.deepEqual([r.status, r.json.code, r.json.params], [400, code, params], mappings);
  }
});

// ---------- Erreurs ----------
test('Erreurs : un code traduisible pour chaque cas', async () => {
  const expected = {
    'jellyfin-bad': 'auth_refused',
    'customapi-bad': 'auth_refused',
    'bazarr-bad': 'auth_refused',
    'pbs-bad': 'auth_refused',
    'speedtest-bad': 'auth_refused',
    'customapi-text': 'unexpected_response',
    'plex-bad': 'auth_refused',
    'qbit-bad': 'qbit_credentials',
    'immich-user': 'immich_admin',
    'goaccess-bad': 'unexpected_response',
    'rss-bad': 'rss_invalid',
    'traefik-bad': 'auth_refused',
    'wazuh-bad': 'wazuh_credentials',
    'crowdsec-bad': 'crowdsec_credentials',
    'crowdsec-badkey': 'crowdsec_key',
    'ical-bad': 'ical_invalid',
    'ical-auth': 'auth_refused',
    'alwaysdata-bad': 'auth_refused',
    'alwaysdata-ip': 'alwaysdata_ip',
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

// ---------- Agent ----------
test('Agent : jeton généré, envoi du vrai script, valeurs bornées, hors ligne', async () => {
  const cfg = (await api('GET', '/api/config')).json;
  assert.equal(cfg.widgets.find((w) => w.id === 'agent').hasApiKey, true, 'jeton généré par le serveur');
  assert.equal((await api('GET', '/api/widgets/agent')).json.code, 'agent_waiting');
  // Commande : admin seulement.
  const saved = cookie;
  cookie = '';
  assert.equal((await api('GET', '/api/agent/agent/setup')).status, 401);
  cookie = saved;
  const setup = (await api('GET', '/api/agent/agent/setup')).json;
  assert.deepEqual(Object.keys(setup).sort(), ['id', 'token']);
  assert.ok(setup.token.length >= 32);
  // Le dernier envoi arrive moins de 2 s après le précédent : ignoré (429).
  for (const [token, status] of [['', 401], ['faux', 401], [setup.token, 200], [setup.token, 429]]) {
    const r = await fetch(`${BASE}/api/agent/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' });
    assert.equal(r.status, status);
  }
  const gap = () => new Promise((r) => setTimeout(r, 2100));
  await gap();
  assert.equal((await fetch(`${BASE}/api/agent/jellyfin`, { method: 'POST', headers: { Authorization: `Bearer ${setup.token}` } })).status, 404, 'pas un agent');
  // Le vrai script, téléchargé depuis le dashboard comme le fait la commande d'installation.
  const script = path.join(dataDir, 'agent.js');
  fs.writeFileSync(script, await (await fetch(`${BASE}/agent/server-dashboard-agent.js`)).text());
  const run = spawn(process.execPath, [script, '--once'], { env: { ...process.env, DASHBOARD_URL: BASE, AGENT_ID: 'agent', AGENT_TOKEN: setup.token } });
  let out = '';
  run.stderr.on('data', (d) => (out += d));
  assert.equal(await new Promise((r) => run.on('exit', r)), 0, out);
  const d = await widget('agent');
  assert.equal(d.hostname, os.hostname());
  assert.ok(d.mem.total > 0 && d.disks.length === 1 && d.cpu >= 0 && d.cpu <= 100);
  assert.equal(d.offline, false);
  // Valeurs absurdes ou hostiles : bornées, texte tronqué, champs inconnus ignorés.
  await gap();
  const push = (body) => fetch(`${BASE}/api/agent/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${setup.token}` }, body: JSON.stringify(body) });
  await push({ hostname: 'x'.repeat(500), cpu: 999, mem: { total: 100, used: 500 }, disks: Array(20).fill({ mount: '/', size: 10, used: -5 }), evil: '<script>', interval: 5 });
  await new Promise((r) => setTimeout(r, 1100)); // cache du widget : 1 s
  const bad = await widget('agent');
  assert.deepEqual([bad.hostname.length, bad.cpu, bad.mem.used, bad.disks.length, bad.disks[0].used, 'evil' in bad], [100, 100, 100, 8, 0, false]);
  // Hors ligne : plus de 3 envois manqués (intervalle de 5 s annoncé : 15 s). Horloge du serveur
  // inaccessible ici : l'intégration est appelée directement avec une date avancée.
  const { INTEGRATIONS } = require('../integrations');
  const now = Date.now;
  INTEGRATIONS.agent.receive({ id: 'direct' }, { hostname: 'pi', interval: 5 });
  try {
    Date.now = () => now() + 16_000;
    const late = await INTEGRATIONS.agent.fetch({ id: 'direct' });
    assert.deepEqual([late.hostname, late.offline], ['pi', true]);
  } finally {
    Date.now = now;
  }
  // Nouveau jeton : l'ancien cesse de marcher.
  const cfg2 = (await api('GET', '/api/config')).json;
  const widgets = cfg2.widgets.map((w) => (w.id === 'agent' ? { ...w, regenerateKey: true } : w));
  assert.equal((await api('PUT', '/api/config', { ...cfg2, widgets })).status, 200);
  const fresh = (await api('GET', '/api/agent/agent/setup')).json.token;
  assert.notEqual(fresh, setup.token);
  await gap();
  for (const [token, status] of [[setup.token, 401], [fresh, 200]]) {
    assert.equal((await fetch(`${BASE}/api/agent/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' })).status, status);
  }
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

test('Notifications : conteneur Proxmox arrêté puis redémarré (« M’alerter » du widget)', async () => {
  const http = require('node:http');
  const received = [];
  const hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => { received.push(JSON.parse(body)); res.end('ok'); });
  });
  const hookPort = await listen(hook);
  const mock = (state) => fetch(`http://localhost:18006/__mock/status/102/${state}`, { method: 'POST' });
  const cfg = (await api('GET', '/api/config')).json;
  const withAlert = (alert) => cfg.widgets.map((w) => (w.id === 'proxmox' ? { ...w, alert } : w));
  try {
    const r = await api('PUT', '/api/config', { ...cfg, widgets: withAlert(true), notify: { type: 'webhook', url: `http://localhost:${hookPort}/`, lang: 'fr' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.widgets.find((w) => w.id === 'proxmox').alert, true, 'case enregistrée');
    await new Promise((res) => setTimeout(res, 700));
    assert.equal(received.length, 0, 'rien au démarrage (la VM windows-11 était déjà arrêtée)');

    await mock('stopped');
    assert.ok(await until(() => received.length === 1, 12_000), 'notification « arrêté »');
    assert.deepEqual([received[0].event, received[0].title], ['down', '🔴 LXC 102 · pulse est hors ligne']);
    await mock('running');
    assert.ok(await until(() => received.length === 2, 12_000), 'notification « redémarré »');
    assert.equal(received[1].event, 'up');
  } finally {
    await mock('running');
    const now = (await api('GET', '/api/config')).json;
    await api('PUT', '/api/config', { ...now, notify: { type: '' }, widgets: now.widgets.map((w) => (w.id === 'proxmox' ? { ...w, alert: false } : w)) });
    hook.close();
  }
});

test('Alertes des widgets : éléments surveillés et messages', async () => {
  const { INTEGRATIONS } = require('../integrations');
  const { message } = require('../notify');
  const of = async (id, type, name = type) => INTEGRATIONS[type].alerts(await widget(id), { id, name, url: 'http://x' });
  const find = (items, id) => items.find((i) => i.id === id);

  const pve = await of('proxmox', 'proxmox', 'Proxmox VE');
  assert.equal(find(pve, 'proxmox:pve:102').online, true);
  assert.equal(find(pve, 'proxmox:pve:120').online, false, 'VM arrêtée');
  assert.deepEqual([find(pve, 'proxmox:disk:pve/local-lvm').online, find(pve, 'proxmox:disk:pve/local-lvm').problem], [true, 'disk'], 'stockage à 74 %');

  const certs = await of('npm', 'npm');
  assert.deepEqual(certs.filter((c) => !c.online).map((c) => [c.name, c.value]).sort(), [['ha.maison.fr', 5], ['vieux.maison.fr', 0]]);

  const kuma = await of('kuma', 'uptimekuma');
  assert.deepEqual(kuma.filter((m) => !m.online).map((m) => m.name), ['Nextcloud'], '« en attente » et maintenance ne sont pas des pannes');

  const cams = await of('frigate', 'frigate', 'Frigate');
  assert.ok(cams.length && cams.every((c) => c.name.startsWith('Frigate · ')));

  const glances = await of('glances-pc', 'glances', 'PC');
  assert.deepEqual(find(glances, 'glances-pc:machine'), { id: 'glances-pc:machine', name: 'PC', url: 'http://x', online: true });
  assert.ok(glances.some((d) => d.problem === 'disk'));
  assert.deepEqual(INTEGRATIONS.glances.offlineCodes, ['glances_offline'], 'machine éteinte = alerte');

  const t = (event, lang = 'fr') => message({ lang }, event).title;
  assert.equal(t({ kind: 'down', problem: 'disk', name: 'NAS · /', value: 93 }), '🟠 Disque presque plein : NAS · / (93 %)');
  assert.equal(t({ kind: 'up', problem: 'cert', name: 'ha.maison.fr' }, 'en'), '🟢 Certificate renewed: ha.maison.fr');
  assert.equal(t({ kind: 'down', name: 'LXC 103 · twingate' }), '🔴 LXC 103 · twingate est hors ligne');
});

test('Widget lent : la réponse précédente est servie pendant le rechargement (module seul)', async () => {
  const { INTEGRATIONS, fetchWidget } = require('../integrations');
  let calls = 0;
  // 1er appel immédiat, les suivants mettent 1 s.
  INTEGRATIONS.lent = { fields: [], cacheMs: 50, fetch: () => new Promise((r) => setTimeout(() => r(++calls), calls ? 1000 : 0)) };
  try {
    const w = { id: 'lent', type: 'lent' };
    assert.equal(await fetchWidget(w), 1);
    await new Promise((r) => setTimeout(r, 60));
    const start = Date.now();
    assert.equal(await fetchWidget(w), 1, 'ancienne réponse');
    assert.ok(Date.now() - start < 800, 'sans attendre le service');
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(await fetchWidget(w), 2, 'nouvelle réponse une fois arrivée');
  } finally {
    delete INTEGRATIONS.lent;
  }
});

test('Statut des tuiles : autre adresse, port TCP, aucune vérification (module seul)', async () => {
  const http = require('node:http');
  const { sanitizeCheck, checkApp } = require('../checks');
  assert.equal(sanitizeCheck(undefined), undefined, 'par défaut : l’adresse de la tuile');
  assert.deepEqual(sanitizeCheck({ mode: 'none', target: 'x' }), { mode: 'none' });
  for (const target of ['192.168.1.10', 'nas.lan:22', '[fe80::1]:8006', 'fe80::1']) {
    assert.deepEqual(sanitizeCheck({ mode: 'ping', target }), { mode: 'ping', target }, target);
  }
  for (const [check, code] of [[{ mode: 'ping', target: 'a b' }, 'check_host_invalid'], [{ mode: 'ping', target: 'nas:99999' }, 'check_host_invalid'],
    [{ mode: 'ping', target: '-c 1000 hote' }, 'check_host_invalid'], [{ mode: 'url', target: 'ftp://x' }, 'invalid_url']]) {
    assert.throws(() => sanitizeCheck(check), (e) => e.key === code, JSON.stringify(check));
  }
  const srv = http.createServer((req, res) => res.end('ok'));
  const port = await listen(srv);
  try {
    assert.equal(await checkApp({ url: 'http://localhost:9/', check: { mode: 'none' } }), null, 'simple lien : pas de statut');
    const viaUrl = await checkApp({ url: 'http://localhost:9/', check: { mode: 'url', target: `http://localhost:${port}/` } });
    assert.deepEqual([viaUrl.online, viaUrl.code], [true, 200], 'l’autre adresse est vérifiée, pas celle de la tuile');
    const tcp = await checkApp({ url: 'http://x/', check: { mode: 'ping', target: `127.0.0.1:${port}` } });
    assert.deepEqual([tcp.online, tcp.port], [true, port]);
    const closed = await checkApp({ url: 'http://x/', check: { mode: 'ping', target: '127.0.0.1:9' } });
    assert.equal(closed.online, false);
  } finally {
    srv.close();
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

test('Tuiles liées à une VM / un LXC Proxmox ou à un conteneur Docker (#89)', { skip: process.platform === 'win32' && 'socket unix' }, async () => {
  const cfg = (await api('GET', '/api/config')).json;
  const app = (id, link) => ({ id, name: id, url: 'http://localhost:9', link });
  const apps = [
    app('l-lxc', { type: 'proxmox', widget: 'proxmox', vmid: 100 }),
    app('l-vm-off', { type: 'proxmox', widget: 'proxmox', vmid: 120 }),
    app('l-gone', { type: 'proxmox', widget: 'proxmox', vmid: 4242 }),
    app('l-docker', { type: 'docker', container: 'jellyfin' }),
    app('l-docker-off', { type: 'docker', container: 'immich-server' }),
    app('l-docker-gone', { type: 'docker', container: 'supprime' }),
    // Refusés : widget qui n'est pas un Proxmox VE, nom de conteneur invalide, type inconnu.
    app('l-not-pve', { type: 'proxmox', widget: 'jellyfin', vmid: 100 }),
    app('l-bad-name', { type: 'docker', container: '../../etc' }),
    app('l-bad-type', { type: 'ssh', host: 'pve' }),
  ];
  try {
    const r = await api('PUT', '/api/config', { ...cfg, categories: [...cfg.categories, { id: 'cat-links', name: 'Liées', apps }] });
    assert.equal(r.status, 200, r.text);
    const saved = Object.fromEntries(r.json.categories.find((c) => c.id === 'cat-links').apps.map((a) => [a.id, a.link]));
    assert.deepEqual(saved['l-lxc'], { type: 'proxmox', widget: 'proxmox', vmid: 100 });
    assert.deepEqual([saved['l-not-pve'], saved['l-bad-name'], saved['l-bad-type']], [undefined, undefined, undefined]);

    const links = (await api('GET', '/api/links')).json;
    assert.equal(links['l-lxc'].name, 'LXC 100 · photo-server');
    assert.ok(links['l-lxc'].running && Math.abs(links['l-lxc'].mem - 0.3) < 1e-9 && links['l-lxc'].cpu === 0.04);
    assert.deepEqual([links['l-vm-off'].name, links['l-vm-off'].running], ['VM 120 · windows-11', false]);
    assert.deepEqual(links['l-gone'], { missing: true });
    // Docker : part de la machine entière (3 % de CPU), mémoire sans le cache (300 Mo / 16 Go).
    assert.equal(links['l-docker'].name, 'Docker · jellyfin');
    assert.ok(links['l-docker'].running && Math.abs(links['l-docker'].cpu - 0.03) < 1e-9 && Math.abs(links['l-docker'].mem - 300e6 / 16e9) < 1e-9);
    assert.deepEqual(links['l-docker-off'], { name: 'Docker · immich-server', running: false });
    assert.deepEqual(links['l-docker-gone'], { missing: true });
    assert.ok(!('l-not-pve' in links), 'pas de lien, pas de mesure');

    // Widget Proxmox supprimé : le lien disparaît avec lui.
    const now = (await api('GET', '/api/config')).json;
    const r2 = await api('PUT', '/api/config', { ...now, widgets: now.widgets.filter((w) => w.id !== 'proxmox') });
    assert.equal(r2.json.categories.find((c) => c.id === 'cat-links').apps.find((a) => a.id === 'l-lxc').link, undefined);
  } finally {
    const now = (await api('GET', '/api/config')).json;
    // Le widget Proxmox revient avec sa clé (supprimé, il l'a perdue).
    const widgets = now.widgets.some((w) => w.id === 'proxmox') ? now.widgets : [...now.widgets, WIDGETS.find((w) => w.id === 'proxmox')];
    await api('PUT', '/api/config', { ...now, widgets, categories: now.categories.filter((c) => c.id !== 'cat-links') });
  }
});

test('Recherche rapide : moteur de recherche web enregistré et vérifié (#91)', async () => {
  const cfg = (await api('GET', '/api/config')).json;
  assert.equal(cfg.searchEngine, 'duckduckgo', 'DuckDuckGo par défaut');
  try {
    for (const engine of ['qwant', 'none', 'https://search.example.com/?q=%s']) {
      const r = await api('PUT', '/api/config', { ...(await api('GET', '/api/config')).json, searchEngine: engine });
      assert.equal(r.json.searchEngine, engine);
    }
    // Absent de la requête (ancienne interface) : inchangé.
    const { searchEngine, ...rest } = (await api('GET', '/api/config')).json;
    assert.equal((await api('PUT', '/api/config', rest)).json.searchEngine, searchEngine);
    const bad = await api('PUT', '/api/config', { ...(await api('GET', '/api/config')).json, searchEngine: 'javascript:alert(1)' });
    assert.deepEqual([bad.status, bad.json.code], [400, 'invalid_url']);
  } finally {
    await api('PUT', '/api/config', { ...(await api('GET', '/api/config')).json, searchEngine: 'duckduckgo' });
  }
});
