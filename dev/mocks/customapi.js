// Fausse API JSON pour le widget API personnalisée : /stats sans clé, /prive avec l'en-tête
// X-Api-Key: custom-key ou en Basic api / api-pass ; /texte renvoie autre chose que du JSON.

const { http, json, ago } = require('./lib');

const stats = () => ({
  data: {
    users: { count: 42 },
    storage: { used: 734_003_200, percent: 73.5 },
    speed: 1_250_000,
    online: true,
    updated: ago(125),
    items: [{ name: 'sauvegarde-nuit' }, { name: 'sauvegarde-midi' }],
  },
});

http.createServer((req, res) => {
  if (req.url === '/stats') return json(res, stats());
  if (req.url === '/prive') {
    const basic = `Basic ${Buffer.from('api:api-pass').toString('base64')}`;
    if (req.headers['x-api-key'] === 'custom-key' || req.headers.authorization === basic) return json(res, stats());
    res.writeHead(401); return res.end();
  }
  if (req.url === '/texte') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>pas du JSON</html>'); }
  res.writeHead(404); res.end();
}).listen(18092);
