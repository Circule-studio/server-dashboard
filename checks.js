// Vérification du statut d'une tuile (#94) : son adresse (par défaut), une autre adresse, un hôte
// (ping ICMP, ou connexion TCP si un port est donné) ou rien (simple lien, pas de pastille).

const net = require('net');
const { execFile } = require('child_process');
const { request, fail } = require('./integrations/lib');

const CHECK_MODES = ['url', 'ping', 'none'];
// Hôte : nom, IPv4 ou IPv6 (entre crochets s'il y a un port), port facultatif.
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*|\[[0-9a-f:.]+\]|[0-9a-f:.]*:[0-9a-f:.]+)(?::(\d{1,5}))?$/i;

// Réglage d'une tuile : absent = l'adresse de la tuile.
function sanitizeCheck(check) {
  const mode = CHECK_MODES.includes(check?.mode) ? check.mode : '';
  if (!mode) return undefined;
  if (mode === 'none') return { mode };
  const target = String(check.target ?? '').trim().slice(0, 2000);
  if (mode === 'url') {
    if (!/^https?:\/\/\S+$/i.test(target)) throw fail('invalid_url', `URL invalide : ${target}`, { url: target });
    return { mode, target };
  }
  const m = target.match(HOST_RE);
  if (!m || (m[1] && (Number(m[1]) < 1 || Number(m[1]) > 65535))) throw fail('check_host_invalid', `Hôte invalide : ${target}`, { host: target });
  return { mode, target };
}

async function httpCheck(url, timeout = 5000) {
  const start = Date.now();
  try {
    const { status } = await request(url, { timeout, discardBody: true });
    // Un 401/403 signifie que le service répond : on le considère en ligne.
    return { online: status < 500, code: status, ms: Date.now() - start };
  } catch (e) {
    return { online: false, error: e.message, errorCode: e.key, ms: Date.now() - start };
  }
}

function tcpCheck(host, port, timeout = 4000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => { socket.destroy(); resolve({ ...result, ms: Date.now() - start }); };
    socket.setTimeout(timeout, () => done({ online: false, errorCode: 'timeout' }));
    socket.once('connect', () => done({ online: true, port }));
    socket.once('error', (e) => done({ online: false, errorCode: e.code === 'ECONNREFUSED' ? 'unreachable' : e.code === 'ENOTFOUND' ? 'host_not_found' : 'host_unreachable' }));
  });
}

// Ping ICMP avec la commande système (pas besoin de droits particuliers : elle a déjà ce qu'il faut).
function icmpCheck(host, timeout = 3000) {
  const start = Date.now();
  const args = process.platform === 'win32' ? ['-n', '1', '-w', String(timeout), host] : ['-c', '1', '-W', String(Math.ceil(timeout / 1000)), host];
  return new Promise((resolve) => {
    execFile('ping', args, { timeout: timeout + 2000, windowsHide: true }, (err, stdout) => {
      if (err?.code === 'ENOENT' || /operation not permitted|permission denied/i.test(String(err?.message || ''))) {
        return resolve({ online: false, errorCode: 'ping_unavailable', ms: Date.now() - start });
      }
      if (err) return resolve({ online: false, errorCode: 'host_unreachable', ms: Date.now() - start });
      // Temps de la réponse si la commande l'affiche (time=, ou « temps= » sous Windows en français).
      const rtt = String(stdout).match(/(?:time|temps)[=<]\s*([\d.]+)\s*ms/i);
      resolve({ online: true, ms: rtt ? Math.round(Number(rtt[1])) : Date.now() - start });
    });
  });
}

// Statut d'une tuile, ou null si elle n'est pas vérifiée.
function checkApp(app) {
  const c = app.check;
  if (c?.mode === 'none') return null;
  if (c?.mode === 'url') return httpCheck(c.target);
  if (c?.mode === 'ping') {
    const m = c.target.match(HOST_RE);
    const host = (m[1] ? c.target.slice(0, c.target.length - m[1].length - 1) : c.target).replace(/^\[|\]$/g, '');
    return m[1] ? tcpCheck(host, Number(m[1])) : icmpCheck(host);
  }
  return app.url ? httpCheck(app.url) : null;
}

module.exports = { sanitizeCheck, checkApp, httpCheck };
