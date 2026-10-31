// Faux Wazuh : API du manager (port 18095, wazuh-wui / wazuh-pass) et indexer OpenSearch (port 18097,
// admin / indexer-pass). Trois agents actifs, un déconnecté, un jamais connecté ; alertes de 24 h.

const { http, json, ago } = require('./lib');

const TOKEN = 'jwt-wazuh';
const AGENTS = [
  { id: '000', name: 'wazuh-manager', status: 'active' },
  { id: '001', name: 'proxmox', status: 'active' },
  { id: '002', name: 'photo-server', status: 'active' },
  { id: '003', name: 'nas', status: 'disconnected', lastKeepAlive: ago(95) },
  { id: '004', name: 'portable', status: 'never_connected' },
];

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/security/user/authenticate') {
    if (req.headers.authorization !== `Basic ${Buffer.from('wazuh-wui:wazuh-pass').toString('base64')}`) { res.writeHead(401); return res.end('{"title":"Unauthorized"}'); }
    return json(res, { data: { token: TOKEN }, error: 0 });
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end(); }
  if (url.pathname === '/agents/summary/status') {
    return json(res, { data: { connection: { active: 3, disconnected: 1, never_connected: 1, pending: 0, total: 5 }, configuration: { synced: 4, not_synced: 1, total: 5 } }, error: 0 });
  }
  if (url.pathname === '/manager/info') return json(res, { data: { affected_items: [{ version: 'v4.12.0', type: 'server' }], total_affected_items: 1 }, error: 0 });
  if (url.pathname === '/agents') {
    const list = url.searchParams.get('status') ? AGENTS.filter((a) => a.status === url.searchParams.get('status')) : AGENTS;
    return json(res, { data: { affected_items: list, total_affected_items: list.length }, error: 0 });
  }
  res.writeHead(404);
  res.end();
}).listen(18095);

http.createServer((req, res) => {
  if (req.headers.authorization !== `Basic ${Buffer.from('admin:indexer-pass').toString('base64')}`) { res.writeHead(401); return res.end('{"error":"Unauthorized"}'); }
  if (!req.url.startsWith('/wazuh-alerts-*/_search')) { res.writeHead(404); return res.end(); }
  const hit = (level, description, agent, minutes) => ({ _source: { timestamp: ago(minutes), rule: { level, description }, agent: { name: agent } } });
  json(res, {
    hits: { total: { value: 412 } },
    aggregations: {
      levels: { buckets: [{ key: 'low', doc_count: 380 }, { key: 'medium', doc_count: 30 }, { key: 'high', doc_count: 2 }] },
      important: {
        doc_count: 32,
        last: { hits: { hits: [
          hit(12, 'Multiple authentication failures followed by a success', 'photo-server', 14),
          hit(10, 'sshd: brute force trying to get access to the system', 'proxmox', 40),
          hit(7, 'Listened ports status (netstat) changed', 'photo-server', 130),
        ] } },
      },
    },
  });
}).listen(18097);
