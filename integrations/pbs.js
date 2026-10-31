// Proxmox Backup Server : occupation des datastores, tâches des dernières 24 h (sauvegardes,
// vérifications, nettoyage…), ressources du serveur. Jeton d'API en lecture seule (rôle Audit) :
// `username` = identifiant du jeton (ex. root@pam!dashboard), `apiKey` = son secret.

const { join, getJson, diskAlerts } = require('./lib');

const DAY_S = 86400;

async function pbs(w) {
  const h = { Authorization: `PBSAPIToken=${w.username}:${w.apiKey}` };
  const since = Math.floor(Date.now() / 1000) - DAY_S;
  const [usage, tasks, status] = await Promise.all([
    getJson(join(w.url, '/api2/json/status/datastore-usage'), h),
    getJson(join(w.url, `/api2/json/nodes/localhost/tasks?since=${since}&limit=500`), h),
    getJson(join(w.url, '/api2/json/nodes/localhost/status'), h),
  ]);
  // Une tâche terminée a un statut : « OK », « WARNINGS: … » ou le message d'erreur.
  const done = (tasks.data || []).filter((x) => x.endtime && x.status);
  const failed = done.filter((x) => x.status !== 'OK' && !x.status.startsWith('WARNINGS'))
    .sort((a, b) => b.endtime - a.endtime)
    .map((x) => ({ type: x.worker_type, id: x.worker_id || '', error: x.status.slice(0, 200), time: new Date(x.endtime * 1000).toISOString() }));
  const backups = done.filter((x) => x.worker_type === 'backup');
  const okBackups = backups.filter((x) => x.status === 'OK' || x.status.startsWith('WARNINGS')).length;
  const s = status.data || {};
  return {
    datastores: (usage.data || []).filter((d) => d.total).map((d) => ({ name: d.store, used: d.used, total: d.total })),
    backups: { ok: okBackups, failed: backups.length - okBackups },
    tasks: done.length,
    failed: failed.slice(0, 5),
    failedCount: failed.length,
    cpu: s.cpu ?? null,
    mem: s.memory?.total ? { used: s.memory.used, total: s.memory.total } : null,
    uptime: s.uptime ?? null,
  };
}

// Alertes (case « M'alerter ») : une tâche en échec dans les dernières 24 h, un datastore à plus de 90 %.
function alerts(d, w) {
  return [
    { id: `${w.id}:tasks`, name: w.name, url: w.url, problem: 'backup', online: d.failedCount === 0, value: d.failedCount },
    ...diskAlerts(w, d.datastores.map((s) => ({ mount: s.name, used: s.used, size: s.total }))),
  ];
}

module.exports = {
  pbs: { fields: ['url', 'username', 'apiKey'], userRequired: true, fetch: pbs, alerts },
};
