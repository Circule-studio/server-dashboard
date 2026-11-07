// Proxmox VE.
// Un jeton d'API en lecture seule suffit (rôle PVEAuditor). `username` = identifiant du
// jeton (ex. root@pam!dashboard), `apiKey` = son secret.

const { join, getJson, diskAlerts, fail } = require('./lib');
const { RANGES, MIB, buildSeries } = require('../history');

async function proxmox(w) {
  const { data } = await getJson(join(w.url, '/api2/json/cluster/resources'), {
    Authorization: `PVEAPIToken=${w.username}=${w.apiKey}`,
  });
  const pct = (used, total) => (total ? used / total : 0);
  const nodes = data.filter((r) => r.type === 'node').map((n) => ({
    name: n.node,
    online: n.status === 'online',
    cpu: n.cpu || 0,
    cores: n.maxcpu,
    mem: n.mem, maxmem: n.maxmem,
    disk: n.disk, maxdisk: n.maxdisk,
    uptime: n.uptime,
  }));
  const guests = data.filter((r) => (r.type === 'qemu' || r.type === 'lxc') && !r.template).map((g) => ({
    id: g.vmid,
    name: g.name || `${g.type}-${g.vmid}`,
    type: g.type === 'qemu' ? 'VM' : 'LXC',
    running: g.status === 'running',
    node: g.node,
    cpu: g.cpu || 0,
    mem: pct(g.mem, g.maxmem),
  })).sort((a, b) => b.running - a.running || a.id - b.id);
  const storages = data.filter((r) => r.type === 'storage' && r.status === 'available' && r.maxdisk).map((s) => ({
    name: s.storage, node: s.node, used: s.disk, total: s.maxdisk,
  }));
  return { nodes, guests, storages, running: guests.filter((g) => g.running).length };
}

// Alertes (case « M'alerter ») : un nœud hors ligne, une VM ou un conteneur arrêté, un stockage
// presque plein. Les modèles (templates) sont déjà écartés. Une machine déjà arrêtée au démarrage
// du suivi ne déclenche rien.
function alerts(d, w) {
  return [
    ...d.nodes.map((n) => ({ id: `${w.id}:node:${n.name}`, name: `Proxmox ${n.name}`, online: n.online, url: w.url })),
    ...d.guests.map((g) => ({ id: `${w.id}:${g.node}:${g.id}`, name: `${g.type} ${g.id} · ${g.name}`, online: g.running, url: w.url })),
    ...diskAlerts(w, d.storages.map((s) => ({ mount: s.name, node: s.node, used: s.used, size: s.total })), (s) => `${s.node}/${s.mount}`),
  ];
}

// ---------- Historique (#136) : Proxmox le tient lui-même (rrddata), rien n'est stocké ici ----------
const RRD_CACHE_MS = 60_000;
const rrdCache = new Map(); // adresse -> { t, rows } ; une entrée par machine et par période
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const percent = (used, total) => (isNum(used) && total > 0 ? Math.round((used / total) * 1000) / 10 : null);
const speed = (v) => (isNum(v) ? Math.round(v * 10) / 10 : null);
const mib = (v) => Math.round(v / MIB);

async function rrd(w, target, range) {
  const url = join(w.url, `/api2/json/${target}/rrddata?timeframe=${range}&cf=AVERAGE`);
  const key = `${w.id} ${w.url} ${url}`;
  const cached = rrdCache.get(key);
  if (cached && Date.now() - cached.t < RRD_CACHE_MS) return cached.rows;
  const { data } = await getJson(url, { Authorization: `PVEAPIToken=${w.username}=${w.apiKey}` });
  const rows = (Array.isArray(data) ? data : []).filter((r) => isNum(r.time)).sort((a, b) => a.time - b.time);
  for (const [k, v] of rrdCache) if (Date.now() - v.t >= RRD_CACHE_MS) rrdCache.delete(k);
  rrdCache.set(key, { t: Date.now(), rows });
  return rows;
}

// Lignes de Proxmox -> points de l'historique, selon ce que chaque type de machine renvoie. Une machine
// arrêtée n'a pas de valeurs : un trou dans la courbe. La taille du disque est la dernière connue.
function nodePoints(rows, sizes) {
  return rows.map((r) => {
    const used = r.rootused ?? r.disk;
    const size = r.roottotal ?? r.maxdisk;
    if (isNum(used) && size > 0) sizes['/'] = size;
    return {
      t: r.time, c: percent(r.cpu, 1), m: percent(r.memused ?? r.mem, r.memtotal ?? r.maxmem),
      r: speed(r.netin), x: speed(r.netout), ...(isNum(used) && size > 0 ? { d: { '/': mib(used) } } : {}),
    };
  });
}

function guestPoints(rows, sizes) {
  return rows.map((r) => {
    // Une VM sans agent invité renvoie un disque à 0 : valeur inconnue, pas un disque vide.
    const known = r.disk > 0 && r.maxdisk > 0;
    if (known) sizes['/'] = r.maxdisk;
    return {
      t: r.time, c: percent(r.cpu, 1), m: percent(r.mem, r.maxmem),
      r: speed(r.netin), x: speed(r.netout), ...(known ? { d: { '/': mib(r.disk) } } : {}),
    };
  });
}

function storagePoints(rows, sizes, name) {
  return rows.flatMap((r) => {
    if (!isNum(r.used) || !(r.total > 0)) return [];
    sizes[name] = r.total;
    return [{ t: r.time, d: { [name]: mib(r.used) } }];
  });
}

// La machine demandée doit être affichée par le widget : rien d'autre n'est demandé à Proxmox.
function resolveTarget(d, q) {
  const inNode = `nodes/${encodeURIComponent(q.node)}`;
  if (q.storage !== undefined) {
    const found = d.storages.some((s) => s.node === q.node && s.name === q.storage);
    return found && { path: `${inNode}/storage/${encodeURIComponent(q.storage)}`, toPoints: (rows, sizes) => storagePoints(rows, sizes, q.storage) };
  }
  if (q.vmid !== undefined) {
    const guest = d.guests.find((g) => g.node === q.node && String(g.id) === q.vmid);
    return guest && { path: `${inNode}/${guest.type === 'VM' ? 'qemu' : 'lxc'}/${guest.id}`, toPoints: guestPoints };
  }
  return d.nodes.some((n) => n.name === q.node) && { path: inNode, toPoints: nodePoints };
}

// Écart habituel entre deux points : Proxmox choisit lui-même sa précision selon la période.
function medianStep(points, fallback) {
  const gaps = points.slice(1).map((p, i) => p.t - points[i].t).sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : fallback;
}

async function history(w, range, query, loadData) {
  const target = resolveTarget(await loadData(), query);
  if (!target) throw fail('history_target', 'Machine introuvable');
  const sizes = {};
  const weekPoints = target.toPoints(await rrd(w, target.path, 'week'), sizes);
  const points = range === 'week' ? weekPoints : target.toPoints(await rrd(w, target.path, range), sizes);
  const from = Date.now() / 1000 - RANGES[range].span;
  const shown = points.filter((p) => p.t >= from);
  return buildSeries(shown, { range, step: medianStep(shown, RANGES[range].step), sizes, weekPoints });
}

module.exports = {
  proxmox: { fields: ['url', 'username', 'apiKey'], userRequired: true, fetch: proxmox, alerts, history },
};
