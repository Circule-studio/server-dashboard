// Pulse (supervision Proxmox, Docker…).
// Jeton d'API Pulse avec le scope monitoring:read. On n'interroge que les
// endpoints des blocs choisis dans le widget (`sections`).

const { join, getJson } = require('./lib');

async function pulse(w) {
  const h = { 'X-API-Token': w.apiKey };
  const sections = w.sections?.length ? w.sections : ['health', 'alerts', 'resources'];
  const out = { sections };
  const tasks = [];

  if (sections.includes('health')) {
    tasks.push(getJson(join(w.url, '/api/state/summary'), h).then((s) => {
      out.health = {
        verdicts: s.verdicts || {},
        counts: { nodes: s.nodes || 0, vms: s.vms || 0, containers: s.containers || 0, docker: (s.dockerHosts || []).length },
        activeAlerts: s.activeAlerts || 0,
        attention: (s.attention || []).slice(0, 6).map((a) => ({
          name: a.name, verdict: a.verdict, reason: a.topReason?.code || '', type: a.type,
        })),
      };
    }));
  }

  if (sections.includes('alerts')) {
    tasks.push(getJson(join(w.url, '/api/alerts/active'), h).then((list) => {
      const order = { critical: 0, warning: 1, info: 2 };
      out.alerts = (Array.isArray(list) ? list : [])
        .map((a) => ({
          level: a.level, resource: a.resourceName || a.resourceId,
          text: a.summary || a.message, since: a.startTime, acknowledged: !!a.acknowledged,
        }))
        .sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3) || new Date(b.since) - new Date(a.since))
        .slice(0, 15);
    }));
  }

  if (sections.includes('resources')) {
    tasks.push(getJson(join(w.url, '/api/resources?type=agent,vm,system-container&limit=100&sort=name'), h).then((r) => {
      const rank = { agent: 0, vm: 1, 'system-container': 2 };
      // Une mesure absente n'est pas 0 % : on la laisse à null (voir la doc de l'API Pulse).
      const pct = (m) => (m ? (m.percent || m.value || 0) : null);
      out.resources = (r.data || [])
        .map((x) => ({
          type: x.type, rank: rank[x.type] ?? 3, name: x.name, status: x.status,
          verdict: x.health?.verdict, parent: x.parentName || '',
          cpu: pct(x.metrics?.cpu), mem: pct(x.metrics?.memory),
        }))
        .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
        .slice(0, 40);
    }));
  }

  await Promise.all(tasks);
  return out;
}

module.exports = {
  pulse: { fields: ['url', 'apiKey'], sections: ['health', 'alerts', 'resources'], fetch: pulse },
};
