// Faux Proxmox Backup Server : jeton root@pam!dashboard / pbs-secret. Deux datastores (dont un
// presque plein), des tâches des dernières 24 h dont une sauvegarde en échec.

const { http, json, GB } = require('./lib');

const now = () => Math.floor(Date.now() / 1000);
const task = (type, id, minAgo, status) => ({ worker_type: type, worker_id: id, starttime: now() - minAgo * 60 - 120, endtime: now() - minAgo * 60, status });

http.createServer((req, res) => {
  if (req.headers.authorization !== 'PBSAPIToken=root@pam!dashboard:pbs-secret') { res.writeHead(401); return res.end(); }
  if (req.url === '/api2/json/status/datastore-usage') return json(res, { data: [
    { store: 'sauvegardes', total: 2000 * GB, used: 1240 * GB, avail: 760 * GB },
    { store: 'externe', total: 500 * GB, used: 470 * GB, avail: 30 * GB },
    { store: 'hors-ligne', error: 'mount error' },
  ] });
  if (req.url.startsWith('/api2/json/nodes/localhost/tasks')) return json(res, { data: [
    task('backup', 'sauvegardes:ct/100', 60, 'OK'),
    task('backup', 'sauvegardes:vm/110', 62, 'WARNINGS: 1'),
    task('backup', 'externe:ct/101', 70, 'backup failed: no space left on device'),
    task('verify', 'sauvegardes', 300, 'OK'),
    task('garbage_collection', 'sauvegardes', 600, 'OK'),
    { worker_type: 'backup', worker_id: 'sauvegardes:ct/102', starttime: now() - 30 }, // en cours
  ] });
  if (req.url === '/api2/json/nodes/localhost/status') return json(res, { data: { cpu: 0.12, memory: { used: 3.1 * GB, total: 8 * GB }, uptime: 864000 } });
  res.writeHead(404); res.end();
}).listen(18007);
