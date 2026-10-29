// Alwaysdata : sites d'un compte d'hébergement et leur état. L'API donne la liste des sites et
// leurs adresses, pas leur état : le dashboard teste lui-même la première adresse de chaque site
// (HTTPS, puis HTTP si HTTPS échoue). `apiKey` = jeton d'API ; `username` = nom du compte,
// utile seulement si le jeton donne accès à plusieurs comptes.

const { request, fail, basicAuth } = require('./lib');

const API = 'https://api.alwaysdata.com/v1';
const MAX_SITES = 12;

async function check(address) {
  const start = Date.now();
  let last;
  for (const scheme of ['https', 'http']) {
    try {
      const { status } = await request(`${scheme}://${address}`, { timeout: 6000, deadline: 8000, discardBody: true });
      return { online: status < 500, code: status, scheme, ms: Date.now() - start };
    } catch (e) {
      last = e;
    }
  }
  return { online: false, error: last?.key || 'unreachable', ms: Date.now() - start };
}

async function alwaysdata(w) {
  const user = w.username ? `${w.apiKey} account=${w.username}` : w.apiKey;
  const r = await request(`${(w.url || API).replace(/\/+$/, '')}/site/`, { headers: { Accept: 'application/json', ...basicAuth(user, '') } });
  // Jeton limité à certaines adresses IP (Profil > Jetons) : celle du dashboard n'y est pas.
  if (r.status === 401 && /ip address not allowed/i.test(r.text)) throw fail('alwaysdata_ip', 'Adresse IP du dashboard non autorisée pour ce jeton');
  if (r.status === 401 || r.status === 403) throw fail('auth_refused', 'Authentification refusée (vérifie la clé API)');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (!Array.isArray(r.json)) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  const sites = r.json
    .map((s) => ({ id: s.id, type: s.type || '', address: (s.addresses || []).find((a) => a && !a.startsWith('*')), note: s.annotation || '' }))
    .filter((s) => s.address);
  const checked = await Promise.all(sites.slice(0, MAX_SITES).map(async (s) => ({ ...s, ...(await check(s.address)) })));
  checked.sort((a, b) => a.online - b.online || a.address.localeCompare(b.address));
  return { sites: checked, up: checked.filter((s) => s.online).length, total: sites.length };
}

module.exports = {
  alwaysdata: { fields: ['apiKey', 'username', 'url'], cacheMs: 60_000, fetch: alwaysdata },
};
