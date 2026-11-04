// Interroge les vrais Loki, Authelia et Watchtower lancés par dev/real-services.sh, avec nos intégrations.
// Vérifie les noms de métriques et les formats, que les faux services ne prouvent pas.
const assert = require('node:assert/strict');
const { INTEGRATIONS } = require('../integrations');

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function until(what, test, seconds = 90) {
  let last;
  for (let i = 0; i < seconds; i++) {
    try {
      const value = await test();
      if (value) return value;
      last = 'pas encore';
    } catch (e) {
      last = e.message;
    }
    await sleep(1000);
  }
  throw new Error(`${what} : ${last}`);
}

async function checkLoki() {
  const url = 'http://127.0.0.1:3100';
  await until('Loki prêt', async () => (await fetch(`${url}/ready`)).ok);
  const ns = () => `${Date.now()}000000`;
  const push = await fetch(`${url}/loki/api/v1/push`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streams: [{ stream: { job: 'ci' }, values: [[ns(), 'tout va bien'], [ns(), 'ERROR panne de test'], [ns(), 'encore une ligne']] }] }),
  });
  assert.equal(push.status, 204);
  const empty = await INTEGRATIONS.loki.fetch({ id: 'l', url: 'http://127.0.0.1:3100', query: '{job="absent"}' });
  assert.equal(empty.lines, 0, 'sélecteur sans résultat');
  const d = await until('Logs visibles', async () => {
    const r = await INTEGRATIONS.loki.fetch({ id: 'l', url });
    return r.lines >= 3 && r.recent.length ? r : null;
  });
  console.log('Loki', JSON.stringify(d));
  assert.ok(d.errors >= 1 && d.bytes > 0);
  assert.equal(d.sources[0].name, 'ci');
  assert.match(d.recent[0].line, /ERROR panne de test/);
}

async function checkAuthelia() {
  const web = 'http://127.0.0.1:9091';
  await until('Authelia prête', async () => (await fetch(`${web}/api/health`)).ok);
  const login = (password) => fetch(`${web}/api/firstfactor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'auth.example.com', 'X-Original-URL': 'https://auth.example.com/' },
    body: JSON.stringify({ username: 'ci', password, keepMeLoggedIn: false }),
  });
  assert.equal((await login('mauvais')).status, 401);
  assert.equal((await login('ci-pass')).status, 200);
  const d = await INTEGRATIONS.authelia.fetch({ id: 'a', url: 'http://127.0.0.1:9959' });
  console.log('Authelia', JSON.stringify(d));
  assert.equal(d.logins.ok, 1, 'connexion réussie');
  assert.equal(d.logins.failed, 1, 'connexion refusée');
  assert.ok(d.since);
  await assert.rejects(INTEGRATIONS.authelia.fetch({ id: 'a', url: web }), (e) => e.key === 'authelia_metrics', 'mauvais port : message clair');
}

async function checkWatchtower() {
  const w = { id: 'w', url: 'http://127.0.0.1:8080', apiKey: 'ci-token' };
  await assert.rejects(until('Watchtower répond', () => INTEGRATIONS.watchtower.fetch({ ...w, apiKey: 'faux' }).then(() => true), 30), (e) => /Jeton refusé/.test(e.message));
  const d = await until('Passage de Watchtower', async () => {
    const r = await INTEGRATIONS.watchtower.fetch(w);
    return r.scans >= 1 ? r : null;
  });
  console.log('Watchtower', JSON.stringify(d));
  assert.ok(d.scanned >= 1, 'au moins lui-même');
  assert.equal(d.failed, 0);
}

(async () => {
  await checkLoki();
  await checkAuthelia();
  await checkWatchtower();
  console.log('Vrais services OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
