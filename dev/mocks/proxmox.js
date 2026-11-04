// Faux Proxmox VE. Pour les tests d'alertes : POST /__mock/status/<vmid>/<running|stopped>
// change l'état d'une machine (sans jeton, faux service seulement).

const { http, json, GB } = require('./lib');

const states = {};

http.createServer((req, res) => {
  const ctl = req.url.match(/^\/__mock\/status\/(\d+)\/(running|stopped)$/);
  if (req.method === 'POST' && ctl) { states[ctl[1]] = ctl[2]; res.writeHead(204); return res.end(); }
  if (req.headers.authorization !== 'PVEAPIToken=root@pam!dashboard=pve-secret') { res.writeHead(401); return res.end(); }
  // Sauvegardes (widget Sauvegardes Proxmox).
  const nowS = Math.floor(Date.now() / 1000);
  const url = req.url.split('?')[0];
  if (url === '/api2/json/nodes') return json(res, { data: [{ node: 'pve', status: 'online' }, { node: 'eteint', status: 'offline' }] });
  if (url === '/api2/json/cluster/backup') return json(res, { data: [{ id: 'job', enabled: 1, 'next-run': nowS + 2 * 86400 }, { id: 'off', enabled: 0, 'next-run': nowS + 3600 }] });
  if (url === '/api2/json/cluster/backup-info/not-backed-up') return json(res, { data: [{ vmid: 102, name: 'pulse', type: 'lxc' }, { vmid: 101, type: 'lxc' }, { vmid: 120, name: 'windows-11', type: 'qemu' }, { vmid: 9000, name: 'debian-template', type: 'lxc' }] });
  if (url === '/api2/json/nodes/pve/tasks') {
    const task = (id, hoursAgo, status) => ({ id, type: 'vzdump', starttime: nowS - hoursAgo * 3600 - 300, endtime: nowS - hoursAgo * 3600, status });
    return json(res, { data: [task('100', 26, 'OK'), task('110', 2, 'backup failed: no space left on device'), { id: '102', type: 'vzdump', starttime: nowS - 30 }] });
  }
  if (url === '/api2/json/nodes/pve/storage') return json(res, { data: [{ storage: 'usb', total: 1000 * GB, used: 400 * GB }] });
  if (url === '/api2/json/nodes/pve/storage/usb/content') {
    const vol = (vmid, hoursAgo, size) => ({ volid: `usb:backup/vzdump-${vmid}-${hoursAgo}.tar.zst`, vmid, ctime: nowS - hoursAgo * 3600, size: size * GB });
    return json(res, { data: [vol(100, 26, 12), vol(100, 200, 11), vol(110, 50, 30)] });
  }
  if (!req.url.startsWith('/api2/json/cluster/resources')) { res.writeHead(404); return res.end(); }
  const cpu = 0.18 + Math.random() * 0.1;
  const data = [
    { type: 'node', node: 'pve', status: 'online', cpu, maxcpu: 16, mem: 41 * GB, maxmem: 64 * GB, disk: 38 * GB, maxdisk: 94 * GB, uptime: 1_036_800 },
    { type: 'lxc', vmid: 100, name: 'photo-server', node: 'pve', status: 'running', cpu: 0.04, maxcpu: 2, mem: 1.2 * GB, maxmem: 4 * GB },
    { type: 'lxc', vmid: 101, name: 'obsidian-livesync', node: 'pve', status: 'running', cpu: 0.01, maxcpu: 1, mem: 0.3 * GB, maxmem: 1 * GB },
    { type: 'lxc', vmid: 102, name: 'pulse', node: 'pve', status: 'running', cpu: 0.02, maxcpu: 1, mem: 0.2 * GB, maxmem: 1 * GB },
    { type: 'qemu', vmid: 110, name: 'home-assistant', node: 'pve', status: 'running', cpu: 0.06, maxcpu: 2, mem: 2.9 * GB, maxmem: 4 * GB },
    { type: 'qemu', vmid: 120, name: 'windows-11', node: 'pve', status: 'stopped', cpu: 0, maxcpu: 4, mem: 0, maxmem: 8 * GB },
    { type: 'lxc', vmid: 9000, name: 'debian-template', node: 'pve', status: 'stopped', template: 1 },
    { type: 'storage', storage: 'local', node: 'pve', status: 'available', disk: 38 * GB, maxdisk: 94 * GB },
    { type: 'storage', storage: 'local-lvm', node: 'pve', status: 'available', disk: 612 * GB, maxdisk: 832 * GB },
  ];
  json(res, { data: data.map((r) => (states[r.vmid] ? { ...r, status: states[r.vmid] } : r)) });
}).listen(18006);
