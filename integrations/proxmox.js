// Proxmox VE.
// Un jeton d'API en lecture seule suffit (rôle PVEAuditor). `username` = identifiant du
// jeton (ex. root@pam!dashboard), `apiKey` = son secret.

const { join, getJson } = require('./lib');

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

// Alertes (case « M'alerter ») : un nœud hors ligne, une VM ou un conteneur arrêté. Les modèles
// (templates) sont déjà écartés. Une machine déjà arrêtée au démarrage du suivi ne déclenche rien.
function alerts(d, w) {
  return [
    ...d.nodes.map((n) => ({ id: `${w.id}:node:${n.name}`, name: `Proxmox ${n.name}`, online: n.online })),
    ...d.guests.map((g) => ({ id: `${w.id}:${g.node}:${g.id}`, name: `${g.type} ${g.id} · ${g.name}`, online: g.running })),
  ].map((a) => ({ ...a, url: w.url }));
}

module.exports = {
  proxmox: { fields: ['url', 'username', 'apiKey'], userRequired: true, fetch: proxmox, alerts },
};
