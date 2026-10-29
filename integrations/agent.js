// Agent : machine qui envoie elle-même ses ressources au dashboard (agent/server-dashboard-agent.js),
// utile derrière un NAT ou sans port ouvert. Pas d'URL : le serveur reçoit les relevés sur
// POST /api/agent/:id (voir server.js) avec le jeton du widget, généré par le serveur.
// Même format de données que Glances, pour le même affichage.

const { fail } = require('./lib');

const reports = new Map(); // id du widget -> { t, data }
// Hors ligne après 3 envois manqués (l'agent indique son intervalle, 30 s par défaut).
const MISSED = 3;

const num = (v, min = 0, max = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Le relevé vient d'une autre machine : chaque champ est vérifié et borné, rien n'est repris tel quel.
function receive(w, body) {
  const b = body && typeof body === 'object' ? body : {};
  const mem = b.mem && num(b.mem.total, 1) ? { total: num(b.mem.total, 1), used: num(b.mem.used, 0, b.mem.total) ?? 0 } : null;
  const load = b.load && num(b.load.min1) !== null ? { min1: num(b.load.min1), cores: num(b.load.cores, 1, 4096) } : null;
  const temp = b.temp && num(b.temp.value, -50, 200) !== null ? { value: num(b.temp.value, -50, 200), label: text(b.temp.label, 40) } : null;
  const data = {
    hostname: text(b.hostname, 100),
    os: text(b.os, 100),
    uptime: num(b.uptime),
    cpu: num(b.cpu, 0, 100),
    cpuName: text(b.cpuName, 100),
    load,
    mem,
    disks: (Array.isArray(b.disks) ? b.disks : []).slice(0, 8)
      .filter((d) => d && num(d.size, 1))
      .map((d) => ({ mount: text(d.mount, 200), size: num(d.size, 1), used: num(d.used, 0, d.size) ?? 0 })),
    temp,
    interval: num(b.interval, 5, 3600) ?? 30,
  };
  reports.set(w.id, { t: Date.now(), data });
}

async function agent(w) {
  const last = reports.get(w.id);
  if (!last) throw fail('agent_waiting', 'En attente du premier envoi de l\'agent');
  const age = Date.now() - last.t;
  // Plus de nouvelles : dernières valeurs affichées, avec l'heure du dernier envoi.
  return { ...last.data, seen: new Date(last.t).toISOString(), offline: age > last.data.interval * 1000 * MISSED };
}

module.exports = {
  // generatedKey : jeton créé par le serveur (server.js), jamais saisi.
  agent: { fields: [], generatedKey: true, cacheMs: 1000, fetch: agent, receive },
};
