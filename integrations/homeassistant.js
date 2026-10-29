// Home Assistant.
// Jeton d'accès longue durée (Profil > Sécurité). Une requête par entité choisie, en parallèle :
// bien plus léger que /api/states, qui renvoie toutes les entités de la maison (souvent des milliers).

const { request, fail, join } = require('./lib');

async function homeassistant(w) {
  const headers = { Authorization: `Bearer ${w.apiKey}`, Accept: 'application/json' };
  const entities = await Promise.all((w.entities || []).map(async (id) => {
    const r = await request(join(w.url, `/api/states/${encodeURIComponent(id)}`), { headers });
    if (r.status === 401 || r.status === 403) throw fail('auth_refused', 'Authentification refusée (vérifie la clé API)');
    if (r.status === 404) return { id, missing: true }; // entité renommée ou supprimée : les autres restent affichées
    if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
    if (!r.json?.entity_id) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
    const a = r.json.attributes || {};
    return {
      id,
      name: a.friendly_name || id,
      state: r.json.state,
      unit: a.unit_of_measurement || '',
      deviceClass: a.device_class || '',
      changed: r.json.last_changed || null,
    };
  }));
  return { entities };
}

module.exports = {
  homeassistant: { fields: ['url', 'apiKey', 'entities'], fetch: homeassistant },
};
