// Faux Pi-hole v6 (sessions limitées comme le vrai : « API seats »).

const { http } = require('./lib');

// Chaque connexion est affichée dans la console : le dashboard doit réutiliser sa session.
// POST /__expire (réservé aux tests) fait expirer toutes les sessions.
const piSessions = new Set();
const PI_MAX_SESSIONS = 3;
http.createServer((req, res) => {
  const reply = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ...obj, took: 0.001 })); };
  const session = (valid, sid = null) => ({ session: { valid, totp: false, sid, csrf: sid ? 'csrf-' + sid : null, validity: valid ? 1800 : -1, message: valid ? 'correct password' : 'password incorrect' } });
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/__expire') { piSessions.clear(); return reply(200, {}); }
    if (req.url === '/api/auth' && req.method === 'POST') {
      let password;
      try { password = JSON.parse(body).password; } catch { return reply(400, { error: { key: 'bad_request', message: 'No valid JSON payload found', hint: null } }); }
      if (password === '2fa-pass') return reply(400, { error: { key: 'bad_request', message: 'No 2FA token found in JSON payload', hint: null } });
      if (password !== 'pihole-pass') return reply(401, session(false));
      if (piSessions.size >= PI_MAX_SESSIONS) return reply(429, { error: { key: 'api_seats_exceeded', message: 'API seats exceeded', hint: 'increase webserver.api.max_sessions' } });
      const sid = require('crypto').randomBytes(16).toString('base64');
      piSessions.add(sid);
      console.log(`pihole: nouvelle session (${piSessions.size} ouverte(s))`);
      return reply(200, session(true, sid));
    }
    const sid = req.headers['x-ftl-sid'];
    if (req.url === '/api/auth' && req.method === 'DELETE') {
      if (piSessions.delete(sid)) console.log(`pihole: session fermée (${piSessions.size} ouverte(s))`);
      res.writeHead(204); return res.end();
    }
    if (!piSessions.has(sid)) return reply(401, { error: { key: 'unauthorized', message: 'Unauthorized', hint: null } });
    if (req.url === '/api/stats/summary') return reply(200, {
      queries: { total: 48213, blocked: 9876, percent_blocked: 20.48389, unique_domains: 3120, forwarded: 30120, cached: 8217, frequency: 0.6 },
      clients: { active: 14, total: 22 },
      gravity: { domains_being_blocked: 1_234_567, last_update: Math.floor(Date.now() / 1000) - 86400 },
    });
    if (req.url === '/api/dns/blocking') return reply(200, { blocking: 'disabled', timer: 272.5 });
    reply(404, { error: { key: 'not_found', message: 'Not found', hint: null } });
  });
}).listen(10080);
