// Sauvegardes, deux widgets pour la dernière sauvegarde (date, taille, succès ou échec) :
// - pvebackup : les sauvegardes faites par Proxmox VE (vzdump), avec le même jeton en lecture seule
//   que le widget Proxmox. Le stockage peut être un disque USB monté dans Proxmox.
// - backup : n'importe quel script (rsync vers un disque USB…), qui envoie son résultat au dashboard
//   avec le jeton du widget, comme un agent (POST /api/agent/:id). Gardé sur disque : une sauvegarde
//   hebdomadaire ne doit pas disparaître au redémarrage du dashboard.

const fs = require('fs');
const path = require('path');
const { fail, join, getJson } = require('./lib');

// ---------- Proxmox VE ----------
const MAX_TASKS = 30;
const lastOf = (list, key) => list.reduce((best, x) => (!best || x[key] > best[key] ? x : best), null);

async function pvebackup(w) {
  const h = { Authorization: `PVEAPIToken=${w.username}=${w.apiKey}` };
  const pve = (p) => getJson(join(w.url, `/api2/json${p}`), h);
  const optional = (p) => pve(p).then((r) => r.data, () => null); // droit manquant : ce bloc reste vide
  const { data: nodes } = await pve('/nodes');
  const online = nodes.filter((n) => n.status === 'online').map((n) => n.node);
  const [resources, jobs, ...perNode] = await Promise.all([
    optional('/cluster/resources?type=vm'),
    optional('/cluster/backup'),
    ...online.map(async (node) => {
      const url = `/nodes/${encodeURIComponent(node)}`;
      const [tasks, storages] = await Promise.all([
        optional(`${url}/tasks?typefilter=vzdump&limit=${MAX_TASKS}`),
        optional(`${url}/storage?content=backup&enabled=1`),
      ]);
      const volumes = await Promise.all((storages || []).map((s) => optional(`${url}/storage/${encodeURIComponent(s.storage)}/content?content=backup`)));
      return { tasks: tasks || [], storages: storages || [], volumes: volumes.flatMap((v) => v || []) };
    }),
  ]);
  const seen = new Set(); // un stockage partagé répond pour chaque nœud
  const volumes = perNode.flatMap((n) => n.volumes).filter((v) => !seen.has(v.volid) && seen.add(v.volid));
  const guests = (resources || []).filter((g) => g.vmid && !g.template);
  const nameOf = (id) => guests.find((g) => g.vmid === id)?.name || '';
  const latest = new Map();
  for (const v of volumes) if (!latest.has(v.vmid) || v.ctime > latest.get(v.vmid).ctime) latest.set(v.vmid, v);
  const tasks = perNode.flatMap((n) => n.tasks).filter((t) => t.endtime);
  const last = lastOf(tasks, 'endtime');
  const storageNames = new Set();
  return {
    last: last && {
      ok: last.status === 'OK',
      status: String(last.status || '').slice(0, 200),
      time: new Date(last.endtime * 1000).toISOString(),
      duration: last.endtime - last.starttime,
      id: last.id ? Number(last.id) || null : null,
    },
    failed: tasks.filter((t) => t.status !== 'OK').length,
    tasks: tasks.length,
    guests: [...latest.values()].sort((a, b) => b.ctime - a.ctime).map((v) => ({
      id: v.vmid, name: nameOf(v.vmid), time: new Date(v.ctime * 1000).toISOString(), size: v.size || 0,
      storage: String(v.volid).split(':')[0], protected: !!v.protected,
    })),
    missing: guests.filter((g) => !latest.has(g.vmid)).map((g) => ({ id: g.vmid, name: g.name || '' })).sort((a, b) => a.id - b.id),
    storages: perNode.flatMap((n) => n.storages).filter((s) => s.total && !storageNames.has(s.storage) && storageNames.add(s.storage))
      .map((s) => ({ name: s.storage, used: s.used || 0, total: s.total })),
    next: (jobs || []).filter((j) => j.enabled !== 0 && j['next-run']).reduce((min, j) => (!min || j['next-run'] < min ? j['next-run'] : min), null),
  };
}

const lastAlert = (w, ok) => [{ id: `${w.id}:last`, name: w.name, url: w.url, problem: 'lastbackup', online: ok }];

// ---------- Script : résultat envoyé au dashboard ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'backup-reports.json');
const MAX_HISTORY = 10;
const LATE_MARGIN = 1.25; // une sauvegarde quotidienne un peu longue n'est pas « en retard »
const MIN_GAP_MS = 2000;

function load() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8'))));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[!] ${FILE} illisible, ignoré : ${e.message}`);
    return new Map();
  }
}
const reports = load();

// Écriture atomique ; en cas d'échec, le résultat reste en mémoire jusqu'au redémarrage.
function save() {
  const tmp = `${FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(reports)), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error(`[!] Impossible d'enregistrer ${FILE} : ${e.message}`);
    try { fs.unlinkSync(tmp); } catch { /* déjà absent */ }
  }
}

const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : null);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function receive(w, body) {
  const b = body && typeof body === 'object' ? body : {};
  const prev = reports.get(w.id);
  if (prev && Date.now() - prev.history[0].t < MIN_GAP_MS) return false;
  const entry = { t: Date.now(), ok: b.ok === true, size: num(b.size, 1e18) };
  reports.set(w.id, {
    history: [entry, ...(prev?.history || [])].slice(0, MAX_HISTORY),
    message: text(b.message, 200),
    target: text(b.target, 200),
    everyHours: num(b.everyHours, 24 * 366),
  });
  save();
  return true;
}

async function backup(w) {
  const r = reports.get(w.id);
  if (!r) throw fail('backup_waiting', 'En attente du premier résultat du script de sauvegarde');
  const [last] = r.history;
  return {
    ok: last.ok,
    time: new Date(last.t).toISOString(),
    size: last.size,
    message: r.message,
    target: r.target,
    everyHours: r.everyHours,
    late: !!r.everyHours && Date.now() - last.t > r.everyHours * 3600_000 * LATE_MARGIN,
    history: r.history.map((x) => ({ time: new Date(x.t).toISOString(), ok: x.ok, size: x.size })),
  };
}

module.exports = {
  pvebackup: {
    fields: ['url', 'username', 'apiKey'], userRequired: true, cacheMs: 60_000, fetch: pvebackup,
    alerts: (d, w) => lastAlert(w, !d.last || d.last.ok),
  },
  backup: {
    fields: [], generatedKey: true, cacheMs: 1000, fetch: backup, receive,
    alerts: (d, w) => lastAlert(w, d.ok && !d.late),
    publicData: ({ message, target, ...d }) => d, // peut citer des chemins ou des messages d'erreur
  },
};
