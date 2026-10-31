// CrowdSec : attaques détectées sur le serveur et adresses bannies, via l'API locale (LAPI, port 8080).
// Deux accès possibles :
//   - clé de bouncer (`apiKey`, `cscli bouncers add dashboard`) : lecture seule, bannissements en cours ;
//   - compte machine (`username` / `password`, `cscli machines add dashboard --password …`) : en plus,
//     les alertes des dernières 24 h avec pays et opérateur de l'attaquant.
// Seules les décisions locales comptent (crowdsec, cscli) : la liste communautaire (CAPI, des dizaines de
// milliers d'adresses) n'est pas une attaque contre ce serveur.

const { request, fail, join, sessionCache } = require('./lib');

const LOCAL_ORIGINS = ['crowdsec', 'cscli'];
const MAX_RECENT = 12;
const TOP = 5;

async function machineLogin(w) {
  const body = JSON.stringify({ machine_id: w.username, password: w.password || '', scenarios: [] });
  const r = await request(join(w.url, '/v1/watchers/login'), {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  if (r.status === 200 && r.json?.token) {
    return { token: r.json.token, expires: Math.max(Date.parse(r.json.expire) || 0, Date.now() + 10 * 60_000) };
  }
  if (r.status === 401 || r.status === 403) throw fail('crowdsec_credentials', 'Identifiants de la machine CrowdSec refusés');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
}

const sessions = sessionCache(machineLogin);

async function machineGet(w, path, retry = true) {
  let session = await sessions.get(w);
  if (session.expires - Date.now() < 5 * 60_000) {
    sessions.drop(w);
    session = await sessions.get(w);
  }
  const r = await request(join(w.url, path), { headers: { Accept: 'application/json', Authorization: `Bearer ${session.token}` } });
  if (r.status === 401 && retry) { // jeton expiré ou LAPI redémarrée
    sessions.drop(w);
    return machineGet(w, path, false);
  }
  if (r.status === 401 || r.status === 403) throw fail('crowdsec_credentials', 'Identifiants de la machine CrowdSec refusés');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  return r.json;
}

async function bouncerGet(w, path) {
  const r = await request(join(w.url, path), { headers: { Accept: 'application/json', 'X-Api-Key': w.apiKey } });
  if (r.status === 401 || r.status === 403) throw fail('crowdsec_key', 'Clé de bouncer CrowdSec refusée');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  return r.json;
}

// « crowdsecurity/ssh-bf » -> « ssh-bf »
const shortScenario = (s) => String(s || '').split('/').pop();

function top(values, n = TOP) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([name, count]) => ({ name, count }));
}

// Bannissements en cours (décisions locales).
function bansOf(decisions) {
  const list = (Array.isArray(decisions) ? decisions : []).filter((d) => LOCAL_ORIGINS.includes(d.origin));
  return { total: list.length, scenarios: top(list.map((d) => shortScenario(d.scenario))) };
}

async function crowdsec(w) {
  if (w.username) {
    const since = encodeURIComponent('24h');
    const [alerts, active] = await Promise.all([
      machineGet(w, `/v1/alerts?since=${since}&include_capi=false&limit=500`),
      machineGet(w, '/v1/alerts?has_active_decision=true&include_capi=false&limit=1000'),
    ]);
    const list = (Array.isArray(alerts) ? alerts : []).filter((a) => a.source?.scope?.toLowerCase() === 'ip' && !a.simulated);
    // Mode simulation : CrowdSec décide sans bannir vraiment, rien à compter.
    const banned = (Array.isArray(active) ? active : []).filter((a) => !a.simulated).flatMap((a) => a.decisions || []);
    const recent = [...list].sort((a, b) => Date.parse(b.start_at || b.created_at) - Date.parse(a.start_at || a.created_at));
    return {
      mode: 'machine',
      alerts24h: list.length,
      attackers24h: new Set(list.map((a) => a.source.ip || a.source.value)).size,
      bans: bansOf(banned),
      countries: top(list.map((a) => a.source.cn)),
      scenarios: top(list.map((a) => shortScenario(a.scenario))),
      recent: recent.slice(0, MAX_RECENT).map((a) => ({
        ip: a.source.ip || a.source.value,
        country: a.source.cn || '',
        as: a.source.as_name || '',
        scenario: shortScenario(a.scenario),
        events: a.events_count ?? null,
        time: new Date(Date.parse(a.start_at || a.created_at) || Date.now()).toISOString(),
        banned: (a.decisions || []).some((d) => d.type === 'ban'),
      })),
    };
  }
  if (!w.apiKey) throw fail('crowdsec_missing', 'Clé de bouncer ou compte machine CrowdSec manquant');
  const decisions = await bouncerGet(w, `/v1/decisions?origins=${LOCAL_ORIGINS.join(',')}`);
  const list = Array.isArray(decisions) ? decisions : [];
  return {
    mode: 'bouncer',
    bans: bansOf(list),
    recent: list.filter((d) => LOCAL_ORIGINS.includes(d.origin)).slice(-MAX_RECENT).reverse().map((d) => ({
      ip: d.value, scenario: shortScenario(d.scenario), duration: d.duration || '', banned: d.type === 'ban',
    })),
  };
}

// Alertes : un pic d'attaques (plus de SPIKE alertes en 24 h) ou un bannissement en cours de plus.
const SPIKE = 50;
const alerts = (d, w) => (d.mode === 'machine'
  ? [{ id: `${w.id}:spike`, name: w.name, url: w.url, problem: 'attacks', online: d.alerts24h < SPIKE, value: d.alerts24h }]
  : []);

module.exports = {
  crowdsec: { fields: ['url', 'apiKey', 'username', 'password'], cacheMs: 20_000, fetch: crowdsec, alerts, reset: () => sessions.clear() },
};
