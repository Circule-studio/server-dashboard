// Mises à jour disponibles (#122) : paquets apt et images Docker en attente, par machine. Les machines
// sont le serveur du dashboard lui-même et celles qui ont un widget Agent, qui envoient leur décompte.
// Affichage seulement : rien n'est installé. Le détail n'est montré qu'aux admins : la liste des
// paquets en retard renseignerait un visiteur sur les failles d'une machine.

const os = require('os');
const { checkUpdates } = require('../agent/server-dashboard-agent');
const { agent } = require('./agent');

const CHECK_EVERY_MS = 6 * 3600_000; // même rythme que l'agent
const MIN_RECHECK_MS = 60_000; // bouton ⟳ : pas plus d'une recherche par minute
const FIRST_WAIT_MS = 1500; // sans registre à interroger, la première recherche est vite finie
const local = { t: 0, data: null, pending: null };

// La recherche peut être longue (registres Docker) : elle se fait en arrière-plan.
function localUpdates() {
  if (Date.now() - local.t >= CHECK_EVERY_MS && !local.pending) {
    local.t = Date.now();
    local.pending = checkUpdates()
      .then((data) => { local.data = data; }, () => {})
      .finally(() => { local.pending = null; });
  }
  return local;
}

const pendingOf = (m) => (m.packages?.count || 0) + (m.docker?.count || 0);

async function updates(w, widgets = []) {
  const here = localUpdates();
  if (!here.data && here.pending) await Promise.race([here.pending, new Promise((r) => { setTimeout(r, FIRST_WAIT_MS); })]);
  const agents = widgets.filter((x) => x.type === 'agent');
  const machines = agents.map((x) => {
    const r = agent.updatesOf(x.id);
    if (!r) return { id: x.id, name: x.name, waiting: true };
    // Agent installé avant cette version (ou AGENT_UPDATES=0) : pas de décompte.
    return { id: x.id, name: x.name, seen: r.seen, offline: r.offline, ...(r.updates || { noData: true }) };
  });
  // Ni apt ni Docker sur le serveur (image Docker sans le socket) : rien à montrer pour lui.
  if (!here.data) machines.unshift({ id: 'local', name: process.env.SERVER_NAME || os.hostname(), checking: true });
  else if (here.data.packages || here.data.docker) machines.unshift({ id: 'local', name: process.env.SERVER_NAME || os.hostname(), ...here.data });
  machines.sort((a, b) => pendingOf(b) - pendingOf(a));
  return {
    total: machines.reduce((n, m) => n + pendingOf(m), 0),
    security: machines.reduce((n, m) => n + (m.packages?.security || 0), 0),
    agents: agents.length,
    machines,
  };
}

// Visiteur non connecté : le nombre par machine, sans les noms ni la part de correctifs de sécurité.
function publicData(d) {
  const counts = (x) => x && (x.error ? null : { count: x.count });
  return {
    total: d.total,
    agents: d.agents,
    hidden: true,
    machines: d.machines.map((m) => ({
      id: m.id, name: m.name, seen: m.seen, offline: m.offline, waiting: m.waiting, noData: m.noData, checking: m.checking,
      packages: counts(m.packages), docker: counts(m.docker),
    })),
  };
}

// Bouton ⟳ : nouvelle recherche ici et sur chaque machine. Le résultat arrive ensuite, l'interface le relit.
function refresh(w, widgets = []) {
  if (Date.now() - local.t >= MIN_RECHECK_MS) local.t = 0;
  for (const x of widgets) if (x.type === 'agent') agent.requestReport(x.id, { updates: true });
}

module.exports = {
  updates: { fields: [], cacheMs: 5000, fetch: updates, withWidgets: true, publicData, refresh },
};
