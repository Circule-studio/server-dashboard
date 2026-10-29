// Widget Agent : ressources envoyées par la machine elle-même (agent/server-dashboard-agent.js),
// même affichage que Glances. Chargé après app.js et glances.js : voir CONTRIBUTING.md.

WIDGET_TYPES.agent = {
  label: 'Agent', icon: '/icons/agent.svg', kind: 'agent', refresh: 15_000, fields: [], urlOptional: true,
  agentSetup: true, // commande d'installation affichée dans le formulaire (voir agentSetup dans app.js)
  waitingCode: 'agent_waiting', // rien reçu encore : message d'attente, pas d'erreur
};

RENDERERS.agent = (d, w) => [
  d.offline
    ? h('p', { class: 'agent-offline' }, h('span', { class: 'dot bad' }), ` ${t('agent.offline', { duration: fmtAgo(d.seen) })}`)
    : null,
  // Hors ligne : dernières valeurs grisées, sans « en ligne depuis ».
  h('div', { class: d.offline ? 'agent-stale' : '' }, RENDERERS.glances(d.offline ? { ...d, uptime: null } : d, w)),
];
