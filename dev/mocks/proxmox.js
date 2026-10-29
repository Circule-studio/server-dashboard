// Faux Proxmox VE.

const { http, json, GB } = require('./lib');

http.createServer((req, res) => {
  if (req.headers.authorization !== 'PVEAPIToken=root@pam!dashboard=pve-secret') { res.writeHead(401); return res.end(); }
  if (!req.url.startsWith('/api2/json/cluster/resources')) { res.writeHead(404); return res.end(); }
  const cpu = 0.18 + Math.random() * 0.1;
  json(res, { data: [
    { type: 'node', node: 'pve', status: 'online', cpu, maxcpu: 16, mem: 41 * GB, maxmem: 64 * GB, disk: 38 * GB, maxdisk: 94 * GB, uptime: 1_036_800 },
    { type: 'lxc', vmid: 100, name: 'photo-server', node: 'pve', status: 'running', cpu: 0.04, maxcpu: 2, mem: 1.2 * GB, maxmem: 4 * GB },
    { type: 'lxc', vmid: 101, name: 'obsidian-livesync', node: 'pve', status: 'running', cpu: 0.01, maxcpu: 1, mem: 0.3 * GB, maxmem: 1 * GB },
    { type: 'lxc', vmid: 102, name: 'pulse', node: 'pve', status: 'running', cpu: 0.02, maxcpu: 1, mem: 0.2 * GB, maxmem: 1 * GB },
    { type: 'qemu', vmid: 110, name: 'home-assistant', node: 'pve', status: 'running', cpu: 0.06, maxcpu: 2, mem: 2.9 * GB, maxmem: 4 * GB },
    { type: 'qemu', vmid: 120, name: 'windows-11', node: 'pve', status: 'stopped', cpu: 0, maxcpu: 4, mem: 0, maxmem: 8 * GB },
    { type: 'lxc', vmid: 9000, name: 'debian-template', node: 'pve', status: 'stopped', template: 1 },
    { type: 'storage', storage: 'local', node: 'pve', status: 'available', disk: 38 * GB, maxdisk: 94 * GB },
    { type: 'storage', storage: 'local-lvm', node: 'pve', status: 'available', disk: 612 * GB, maxdisk: 832 * GB },
  ] });
}).listen(18006);
