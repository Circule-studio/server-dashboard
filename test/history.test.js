// Tests de l'historique des ressources (#136), sans serveur : npm test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHistory, estimateFill, MIB } = require('../history');
const { parseNetDev } = require('../agent/server-dashboard-agent');

const GIB = 1024 ** 3;
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const MIN = 60_000;
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-history-')), 'history.json');

test('Les relevés sont moyennés par point, le point en cours compris', () => {
  const h = createHistory(tmpFile());
  h.add('a', { cpu: 10, mem: 40 }, NOW);
  h.add('a', { cpu: 30, mem: 60 }, NOW + 30_000);
  h.add('a', { cpu: 50, mem: 80 }, NOW + 5 * MIN);
  const s = h.read('a', 'day', { now: NOW + 5 * MIN });
  assert.deepEqual(s.cpu, [20, 50]);
  assert.deepEqual(s.mem, [50, 80]);
  assert.equal(s.step, 120);
});

test('Une machine inconnue donne des colonnes vides, et une panne reste un trou', () => {
  const h = createHistory(tmpFile());
  assert.deepEqual(h.read('inconnue', 'week', { now: NOW }).t, []);
  h.add('a', { cpu: 10 }, NOW);
  h.add('a', { cpu: 10 }, NOW + 60 * MIN); // une heure sans relevé
  const { t } = h.read('a', 'day', { now: NOW + 60 * MIN });
  assert.equal(t.length, 2);
  assert.equal(t[1] - t[0], 3600);
});

test('Les points plus vieux que la période sortent de la courbe', () => {
  const h = createHistory(tmpFile());
  h.add('a', { cpu: 10 }, NOW);
  h.add('a', { cpu: 20 }, NOW + 25 * 60 * MIN);
  assert.deepEqual(h.read('a', 'day', { now: NOW + 25 * 60 * MIN }).cpu, [20]);
  assert.deepEqual(h.read('a', 'week', { now: NOW + 25 * 60 * MIN }).cpu, [10, 20]);
});

test('Débit réseau : écart entre deux relevés, sans valeur après un redémarrage ou un long silence', () => {
  const h = createHistory(tmpFile());
  h.add('a', { net: { rx: 1000, tx: 500 } }, NOW);
  h.add('a', { net: { rx: 61000, tx: 6500 } }, NOW + MIN); // +60 Ko et +6 Ko en 60 s
  let s = h.read('a', 'day', { now: NOW + MIN });
  assert.equal(s.rx.at(-1), 1000);
  assert.equal(s.tx.at(-1), 100);

  h.add('a', { net: { rx: 100, tx: 100 } }, NOW + 4 * MIN); // compteur reparti de zéro
  s = h.read('a', 'day', { now: NOW + 4 * MIN });
  assert.equal(s.rx.at(-1), null);

  h.add('a', { net: { rx: 500, tx: 500 } }, NOW + 60 * MIN); // silence d'une heure
  s = h.read('a', 'day', { now: NOW + 60 * MIN });
  assert.equal(s.rx.at(-1), null);
});

test('Disques : occupation par disque, et seuls les disques encore suivis sont renvoyés', () => {
  const h = createHistory(tmpFile());
  h.add('a', { disks: [{ path: '/', used: 10 * GIB, size: 100 * GIB }, { path: '/mnt', used: GIB, size: 2 * GIB }] }, NOW);
  h.add('a', { disks: [{ path: '/', used: 11 * GIB, size: 100 * GIB }] }, NOW + 5 * MIN);
  const s = h.read('a', 'day', { names: { '/': 'Système' }, now: NOW + 5 * MIN });
  assert.equal(s.disks.length, 1);
  assert.equal(s.disks[0].name, 'Système');
  assert.equal(s.disks[0].size, 100 * GIB);
  assert.deepEqual(s.disks[0].used, [10 * GIB, 11 * GIB]);
});

test('Estimation « disque plein » : pente régulière, sans réponse quand elle ne veut rien dire', () => {
  const hour = 3600;
  const series = (perHour, hours = 120, start = 500) => Array.from({ length: hours }, (_, i) => ({ t: i * hour, d: { '/': start + i * perHour } }));
  const size = 1000 * MIB;

  // 24 Mio par jour, 381 Mio restants après 5 jours : environ 16 jours.
  assert.equal(estimateFill(series(1), '/', size), 16);
  assert.equal(estimateFill(series(0), '/', size), null); // stable
  assert.equal(estimateFill(series(-1), '/', size), null); // en baisse
  assert.equal(estimateFill(series(1, 50), '/', size), null); // moins de 3 jours d'écarts
  assert.equal(estimateFill(series(0.001), '/', size), null); // plus d'un an
  assert.equal(estimateFill(series(1, 120, 2000), '/', size), null); // déjà plein
  assert.equal(estimateFill(series(1), '/autre', size), null);
});

test('Estimation « disque plein » : un saut ponctuel n\'annonce pas un disque plein', () => {
  const size = 100_000 * MIB;
  const days = (...values) => values.map((v, i) => ({ t: i * 86400, d: { '/': v } }));
  // Relevés réels d'un LXC et d'un stockage de sauvegarde : deux sauts, puis un seul, stables le reste du temps.
  assert.equal(estimateFill(days(28_000, 29_000, 39_000, 39_000, 39_000, 43_000, 43_000), '/', size), null);
  assert.equal(estimateFill(days(190_000, 193_000, 193_000, 193_000, 193_000, 226_000, 226_000), '/', 400_000 * MIB), null);
  // Une croissance régulière, même avec un saut et un jour de baisse, garde son rythme médian.
  assert.equal(estimateFill(days(10_000, 11_000, 12_000, 18_000, 19_000, 18_900, 19_900, 20_900), '/', size), 79);
});

test('L\'historique survit à un redémarrage, et un fichier abîmé ne bloque pas le démarrage', () => {
  const file = tmpFile();
  const first = createHistory(file);
  first.add('a', { cpu: 10, disks: [{ path: '/', used: GIB, size: 2 * GIB }] }, NOW);
  first.add('a', { cpu: 20 }, NOW + 5 * MIN);
  assert.equal(first.save(NOW + 5 * MIN), true);

  const again = createHistory(file);
  const s = again.read('a', 'day', { now: NOW + 5 * MIN });
  assert.deepEqual(s.cpu, [10, 20]);
  assert.equal(s.disks[0].size, 2 * GIB);

  fs.writeFileSync(file, '{ pas du json');
  const broken = createHistory(file);
  assert.deepEqual(broken.read('a', 'day', { now: NOW }).t, []);
});

test('Une machine sans point depuis une semaine est oubliée à l\'enregistrement', () => {
  const file = tmpFile();
  const h = createHistory(file);
  h.add('vieille', { cpu: 10 }, NOW);
  h.add('recente', { cpu: 10 }, NOW + 8 * 1440 * MIN);
  h.save(NOW + 8 * 1440 * MIN);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), ['recente']);
});

// Windows arrête le processus sans lui laisser le temps de réagir au signal.
test('À l\'arrêt du service, l\'historique est enregistré', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-history-'));
  const script = `const { history } = require('./history');
    history.add('a', { cpu: 10 });
    history.start(async () => {});
    setInterval(() => {}, 1000);
    console.log('prêt');`;
  const child = spawn(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: dir } });
  await new Promise((resolve) => { child.stdout.once('data', resolve); });
  const exited = new Promise((resolve) => { child.once('exit', resolve); });
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'))), ['a']);
});

test('Compteurs réseau : seules les vraies interfaces comptent, pour ne rien compter deux fois', () => {
  const text = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 500 5 0 0 0 0 0 0 500 5 0 0 0 0 0 0
  eno1: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0
vmbr0: 900 9 0 0 0 0 0 0 1900 19 0 0 0 0 0 0
veth100i0: 7 1 0 0 0 0 0 0 7 1 0 0 0 0 0 0
docker0: 7 1 0 0 0 0 0 0 7 1 0 0 0 0 0 0
  eth1: 1 1 0 0 0 0 0 0 3 1 0 0 0 0 0 0
`;
  assert.deepEqual(parseNetDev(text), { rx: 1001, tx: 2003 });
  assert.equal(parseNetDev('Inter-|\n face |\n    lo: 1 1 0 0 0 0 0 0 1 1 0 0 0 0 0 0\n'), null);
});
