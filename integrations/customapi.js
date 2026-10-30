// API personnalisée : n'importe quelle URL qui renvoie du JSON. Les valeurs à afficher sont
// choisies par leur chemin dans la réponse (`mappings`, vérifiés par server.js), ex.
// `data.users.count` ou `items.0.name` ; `liste.length` donne la taille d'une liste.
// Authentification facultative : identifiant / mot de passe (Basic) ou un en-tête dans `apiKey`
// (« X-Api-Key: abc », ou une valeur seule envoyée en « Authorization: Bearer … »).

const { getJson, basicAuth } = require('./lib');

// Valeur au bout du chemin, ou null. Seules les propriétés propres sont suivies (pas de
// __proto__, constructor…) ; une valeur qui n'est pas simple (objet, liste) donne null.
function pick(data, path) {
  let v = data;
  for (const seg of path.split('.')) {
    if (Array.isArray(v) && seg === 'length') v = v.length;
    else if (v && typeof v === 'object' && Object.hasOwn(v, seg)) v = v[seg];
    else return null;
  }
  return ['string', 'number', 'boolean'].includes(typeof v) ? v : null;
}

function headersOf(w) {
  const headers = {};
  if (w.username || w.password) Object.assign(headers, basicAuth(w.username, w.password));
  if (w.apiKey) {
    const m = w.apiKey.match(/^([A-Za-z0-9-]+)\s*:\s*(.+)$/);
    if (m) headers[m[1]] = m[2].trim();
    else headers.Authorization = `Bearer ${w.apiKey}`;
  }
  return headers;
}

async function customapi(w) {
  const data = await getJson(w.url, headersOf(w));
  return { values: w.mappings.map((m) => ({ label: m.label || m.path, format: m.format, value: pick(data, m.path) })) };
}

module.exports = {
  customapi: { fields: ['url', 'mappings', 'apiKey', 'username', 'password'], cacheMs: 10_000, fetch: customapi },
};
