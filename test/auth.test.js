// Garanties d'accès du dashboard (#172) : REQUIRE_LOGIN, connexion et sa limite, déconnexion qui survit à
// un redémarrage, conflit d'enregistrement, actions Docker. Un dashboard à part, avec son faux Docker : npm test.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 17676;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'auth-test';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-auth-'));
const SOCKET = path.join(dir, 'docker.sock');
const CONTAINER = 'a'.repeat(64);

let server;
let docker;
const dockerCalls = [];

// Lance le dashboard et attend qu'il écoute.
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(dir, 'data'), ADMIN_PASSWORD: PASSWORD, REQUIRE_LOGIN: 'true', DOCKER_SOCKET: SOCKET, UPDATE_CHECK: 'false', RUN_AS: '' },
    });
    let out = '';
    const onData = (d) => { out += d; if (out.includes('Server Dashboard sur')) resolve(child); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`dashboard arrêté (code ${code})\n${out}`)));
  });
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => { server.once('exit', resolve); server.kill(); });
}

const call = (method, url, { cookie, body } = {}) => fetch(BASE + url, {
  method,
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function login(password = PASSWORD) {
  const r = await call('POST', '/api/login', { body: { password } });
  return { r, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

before(async () => {
  // Faux Docker : liste d'un conteneur et actions start / stop / restart.
  docker = http.createServer((req, res) => {
    dockerCalls.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url.startsWith('/containers/json')) return res.end(JSON.stringify([{ Id: CONTAINER, Names: ['/web'], Image: 'nginx', State: 'running', Status: 'Up' }]));
    if (req.method === 'POST' && req.url.startsWith(`/containers/${CONTAINER}/`)) return res.writeHead(204).end();
    res.writeHead(404).end('{"message":"not found"}');
  });
  await new Promise((r) => docker.listen(SOCKET, r));
  server = await startServer();
});

after(async () => {
  await stopServer();
  await new Promise((r) => docker.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('REQUIRE_LOGIN : chaque route de lecture refusée sans connexion', async () => {
  const routes = ['/api/config', '/api/status', '/api/system', '/api/history?range=day', '/api/links', '/api/docker/containers', '/api/background', '/api/widgets/w1'];
  for (const url of routes) {
    const r = await call('GET', url);
    assert.equal(r.status, 401, url);
    assert.equal((await r.json()).code, 'auth_required', url);
  }
  // Manifeste de l'application : sans le titre du tableau.
  const m = await (await call('GET', '/manifest.webmanifest')).json();
  assert.equal(m.name, 'Server Dashboard');
  // /api/me reste lisible : c'est lui qui dit à l'interface d'afficher la connexion.
  assert.deepEqual(await (await call('GET', '/api/me')).json(), { authenticated: false, loginRequired: true, defaultPassword: false });
});

test('Connexion : mauvais mot de passe refusé, bon mot de passe accepté', async () => {
  const bad = await login('faux');
  assert.equal(bad.r.status, 401);
  assert.equal((await bad.r.json()).code, 'bad_password');
  const { r, cookie } = await login();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await call('GET', '/api/config', { cookie })).status, 200);
});

test('Enregistrement : refusé sans connexion, conflit 409 sur une révision périmée', async () => {
  assert.equal((await call('PUT', '/api/config', { body: { categories: [] } })).status, 401);
  const { cookie } = await login();
  const cfg = await (await call('GET', '/api/config', { cookie })).json();
  assert.equal((await call('PUT', '/api/config', { cookie, body: { ...cfg, title: 'Un' } })).status, 200);
  const stale = await call('PUT', '/api/config', { cookie, body: { ...cfg, title: 'Deux' } }); // même révision qu'avant
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'conflict');
});

test('Actions Docker : connexion obligatoire, identifiant et action vérifiés', async () => {
  assert.equal((await call('POST', `/api/docker/containers/${CONTAINER}/restart`)).status, 401);
  const { cookie } = await login();
  assert.equal((await call('POST', '/api/docker/containers/pas-un-id/restart', { cookie })).status, 400);
  assert.equal((await call('POST', `/api/docker/containers/${CONTAINER}/kill`, { cookie })).status, 400);
  dockerCalls.length = 0;
  const ok = await call('POST', `/api/docker/containers/${CONTAINER}/restart`, { cookie });
  assert.equal(ok.status, 200);
  assert.deepEqual(dockerCalls, [`POST /containers/${CONTAINER}/restart`], 'une seule action, transmise telle quelle');
});

test('Déconnexion : le cookie est refusé ensuite, y compris après un redémarrage', async () => {
  const { cookie } = await login();
  assert.equal((await call('POST', '/api/logout', { cookie })).status, 200);
  assert.equal((await call('GET', '/api/config', { cookie })).status, 401);
  await stopServer();
  server = await startServer();
  assert.equal((await call('GET', '/api/config', { cookie })).status, 401, 'session fermée retenue sur le disque');
  const fresh = await login();
  assert.equal((await call('GET', '/api/config', { cookie: fresh.cookie })).status, 200, 'une nouvelle connexion marche');
});

// En dernier : la limite bloque ensuite toute connexion depuis cette adresse pendant 15 min.
test('Connexion : 10 échecs, puis 429 avec Retry-After, même avec le bon mot de passe', async () => {
  await stopServer();
  server = await startServer(); // compteurs remis à zéro
  for (let i = 0; i < 10; i++) assert.equal((await login('faux')).r.status, 401, `essai ${i + 1}`);
  const { r } = await login();
  assert.equal(r.status, 429);
  assert.equal((await r.json()).code, 'too_many_attempts');
  assert.ok(Number(r.headers.get('retry-after')) > 0);
});
