// Faux Pulse (format de l'API Pulse v6).

const { http, json, ago } = require('./lib');

http.createServer((req, res) => {
  if (req.headers['x-api-token'] !== 'pulse-token') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
  if (req.url.startsWith('/api/state/summary')) return json(res, {
    activeAlerts: 2, nodes: 1, vms: 2, containers: 4,
    dockerHosts: [{ name: 'photo-server', containers: 6, uptimeSeconds: 86400, cpuUsagePercent: 4 }],
    verdicts: { ok: 5, attention: 1, critical: 1, stale: 0, off: 1, unknown: 0 },
    attention: [
      { id: 'storage-backup', name: 'backup', type: 'storage', verdict: 'critical', topReason: { code: 'disk-usage-high' } },
      { id: 'lxc-102', name: 'pulse', type: 'system-container', verdict: 'attention', topReason: { code: 'memory-high' } },
    ],
    lastUpdate: new Date().toISOString(),
  });
  if (req.url.startsWith('/api/alerts/active')) return json(res, [
    { id: 'a1', type: 'disk', level: 'critical', resourceId: 'storage-backup', resourceName: 'backup', node: 'pve',
      message: 'Storage backup is 94% full', summary: 'Disk at 94%', value: 94, threshold: 90, startTime: ago(180), acknowledged: false },
    { id: 'a2', type: 'memory', level: 'warning', resourceId: 'lxc-102', resourceName: 'pulse', node: 'pve',
      message: 'Container pulse memory at 86%', summary: 'Memory at 86%', value: 86, threshold: 85, startTime: ago(25), acknowledged: true },
  ]);
  if (req.url.startsWith('/api/resources')) {
    const r = (id, type, name, status, cpu, mem, verdict = 'ok') => ({
      id, type, name, status, health: { verdict }, parentName: type === 'agent' ? '' : 'pve',
      metrics: cpu == null ? undefined : { cpu: { value: cpu, percent: cpu }, memory: { value: mem, percent: mem } },
    });
    const data = [
      r('node-pve', 'agent', 'pve', 'online', 21, 64),
      r('lxc-100', 'system-container', 'photo-server', 'online', 4, 30),
      r('lxc-101', 'system-container', 'obsidian-livesync', 'online', 1, 31),
      r('lxc-102', 'system-container', 'pulse', 'warning', 3, 86, 'attention'),
      r('lxc-103', 'system-container', 'twingate-connector', 'online', 0, 11),
      r('vm-110', 'vm', 'home-assistant', 'online', 6, 73),
      r('vm-120', 'vm', 'windows-11', 'offline', null, null, 'off'),
    ];
    return json(res, { data, meta: { page: 1, limit: 100, total: data.length, totalPages: 1 }, aggregations: {} });
  }
  res.writeHead(404); res.end();
}).listen(17655);
