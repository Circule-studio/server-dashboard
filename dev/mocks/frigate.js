// Faux Frigate.

const { http, json } = require('./lib');

// Miniatures : petites images PNG générées ici (dégradé de couleur), sans dépendance.
const zlib = require('zlib');
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(width, height, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // 8 bits, RVB
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const f = 0.45 + 0.55 * (y / height);
      row.set([r * f, g * f, b * (1 - x / width / 2)].map(Math.round), 1 + x * 3);
    }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const now = () => Date.now() / 1000;
const FRIGATE_EVENTS = [
  { id: `${Math.floor(now() - 90)}.123-abcd`, camera: 'entree', label: 'person', sub_label: ['Thomas', 0.91], top_score: 0.88, start_time: now() - 90, end_time: null, color: [96, 140, 230] },
  { id: `${Math.floor(now() - 1500)}.456-efgh`, camera: 'jardin', label: 'cat', sub_label: null, data: { top_score: 0.79 }, start_time: now() - 1500, end_time: now() - 1440, color: [120, 190, 120] },
  { id: `${Math.floor(now() - 5400)}.789-ijkl`, camera: 'entree', label: 'package', sub_label: null, data: { top_score: 0.83 }, start_time: now() - 5400, end_time: now() - 5300, color: [200, 160, 90] },
  { id: `${Math.floor(now() - 9000)}.012-mnop`, camera: 'jardin', label: 'car', sub_label: 'AB-123-CD', data: { top_score: 0.93 }, start_time: now() - 9000, end_time: now() - 8900, color: [190, 100, 100] },
  { id: 'sans-miniature', camera: 'garage', label: 'dog', start_time: now() - 20000, end_time: now() - 19900 },
];
function frigateApi(req, res) {
  if (req.url.startsWith('/api/stats')) return json(res, {
    cameras: {
      entree: { camera_fps: 5.1, detection_fps: 1.2, process_fps: 5 },
      jardin: { camera_fps: 5, detection_fps: 0.4, process_fps: 5 },
      garage: { camera_fps: 0, detection_fps: 0, process_fps: 0 },
    },
    detectors: { coral: { inference_speed: 8.47 } },
    service: { version: '0.14.1', uptime: 86400 },
  });
  if (req.url.startsWith('/api/events?')) return json(res, FRIGATE_EVENTS.map(({ color, ...e }) => e));
  const m = req.url.match(/^\/api\/events\/([^/]+)\/thumbnail\.jpg$/);
  const e = m && FRIGATE_EVENTS.find((x) => x.id === m[1]);
  if (e?.color) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png(160, 120, e.color)); }
  // Piège pour les tests : une image hors de /api/events/, que le dashboard ne doit jamais relayer
  // (un identifiant « .. » ferait remonter /api/events/../thumbnail.jpg jusqu'ici).
  if (req.url === '/api/thumbnail.jpg') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png(8, 8, [255, 0, 0])); }
  res.writeHead(404); res.end('{"success":false}');
}
http.createServer(frigateApi).listen(15000);
// Avec connexion (Frigate 0.14+, port 8971) : POST /api/login donne le cookie frigate_token.
const frigateTokens = new Set();
let frigateLogins = 0; // GET /__logins (réservé aux tests) : nombre de tentatives de connexion
http.createServer((req, res) => {
  if (req.url === '/__logins') return json(res, { count: frigateLogins });
  if (req.method === 'POST' && req.url === '/api/login') {
    let b = ''; req.on('data', (d) => (b += d));
    return req.on('end', () => {
      let body = {};
      try { body = JSON.parse(b); } catch { /* corps invalide */ }
      frigateLogins++;
      if (body.user !== 'viewer' || body.password !== 'frigate-pass') { res.writeHead(401); return res.end('{"message":"Login failed"}'); }
      const token = Math.random().toString(36).slice(2);
      frigateTokens.add(token);
      res.writeHead(200, { 'Set-Cookie': `frigate_token=${token}; Path=/; HttpOnly`, 'Content-Type': 'application/json' });
      res.end('{}');
    });
  }
  const token = ((req.headers.cookie || '').match(/frigate_token=([^;]+)/) || [])[1];
  if (!frigateTokens.has(token)) { res.writeHead(401); return res.end('{"message":"Unauthorized"}'); }
  frigateApi(req, res);
}).listen(18971);
