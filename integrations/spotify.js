// Spotify : ce qui joue en ce moment et les dernières écoutes. Il faut une application créée sur
// developer.spotify.com (son propriétaire doit avoir Spotify Premium) : `username` = Client ID,
// `password` = Client Secret. `apiKey` = jeton de rafraîchissement, obtenu par la connexion au compte
// (routes /api/widgets/:id/oauth de server.js), jamais saisi. Il expire au bout de 6 mois.
//
// Spotify n'accepte comme adresse de retour que https ou 127.0.0.1 : un dashboard en http sur le réseau
// local ne peut pas la recevoir. La page de retour ne s'affiche donc pas, et on recopie son adresse.

const crypto = require('crypto');
const { request, fail, join, basicAuth, sessionCache } = require('./lib');

const ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com';
const API = process.env.SPOTIFY_API_URL || 'https://api.spotify.com';
const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const SCOPES = 'user-read-playback-state user-read-currently-playing user-read-recently-played';
const REFRESH_LIFETIME_MS = 182 * 86400_000; // 6 mois, selon Spotify
const STATE_MS = 15 * 60_000;
const RECENT_MS = 5 * 60_000; // l'historique change peu : pas besoin de le demander à chaque fois
const MAX_RECENT = 5;

async function tokenRequest(w, params) {
  const body = new URLSearchParams(params).toString();
  const r = await request(`${ACCOUNTS}/api/token`, {
    method: 'POST', body, verifyTls: true,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json', ...basicAuth(w.username, w.password) },
  });
  if (r.status === 200 && r.json?.access_token) return r.json;
  if (r.json?.error === 'invalid_client') throw fail('spotify_credentials', 'Client ID ou Client Secret refusé par Spotify');
  if (r.json?.error === 'invalid_grant') return null;
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  throw fail('unexpected_response', 'Réponse inattendue de Spotify');
}

const sessions = sessionCache(async (w) => {
  const t = await tokenRequest(w, { grant_type: 'refresh_token', refresh_token: w.apiKey });
  if (!t) throw fail('spotify_reauth', 'Connexion à Spotify expirée : reconnecte le compte dans le widget');
  return { token: t.access_token, expires: Date.now() + (t.expires_in || 3600) * 1000 - 60_000 };
});

async function spotifyGet(w, path, retry = true) {
  let session = await sessions.get(w);
  if (session.expires < Date.now()) {
    sessions.drop(w);
    session = await sessions.get(w);
  }
  const r = await request(join(API, path), { verifyTls: true, headers: { Accept: 'application/json', Authorization: `Bearer ${session.token}` } });
  if (r.status === 401 && retry) {
    sessions.drop(w);
    return spotifyGet(w, path, false);
  }
  if (r.status === 204) return null; // rien en cours de lecture
  if (r.status === 401 || r.status === 403) throw fail('spotify_forbidden', 'Refusé par Spotify : le propriétaire de l\'application doit avoir Premium, et ce compte être dans ses utilisateurs');
  if (r.status === 429) throw fail('spotify_rate', 'Trop de demandes à Spotify : réessaie dans quelques minutes');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue de Spotify');
  return r.json;
}

const https = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);
// La plus petite image d'au moins 64 px (Spotify les range de la plus grande à la plus petite).
const imageOf = (images = []) => https((images.filter((i) => i.width >= 64).pop() || images[images.length - 1])?.url);

function itemOf(item) {
  if (!item) return null;
  const episode = item.type === 'episode';
  return {
    title: String(item.name || '').slice(0, 200),
    artists: (episode ? [item.show?.name] : (item.artists || []).map((a) => a.name)).filter(Boolean).join(', ').slice(0, 200),
    image: imageOf(episode ? item.images || item.show?.images : item.album?.images),
    url: https(item.external_urls?.spotify),
    duration: item.duration_ms || 0,
  };
}

const recents = new Map(); // id du widget -> { t, list }

async function recentOf(w) {
  const known = recents.get(w.id);
  if (known && Date.now() - known.t < RECENT_MS) return known.list;
  const data = await spotifyGet(w, `/v1/me/player/recently-played?limit=${MAX_RECENT}`);
  const list = (data?.items || []).map((x) => ({ ...itemOf(x.track), playedAt: x.played_at }));
  recents.set(w.id, { t: Date.now(), list });
  return list;
}

async function spotify(w) {
  if (!w.apiKey) throw fail('spotify_connect', 'Compte pas encore connecté : ouvre ce widget en mode édition pour le connecter');
  const [player, recent] = await Promise.all([
    spotifyGet(w, '/v1/me/player?additional_types=track,episode'),
    recentOf(w).catch(() => recents.get(w.id)?.list || []), // historique optionnel : la lecture reste affichée
  ]);
  const item = itemOf(player?.item);
  const expires = w.authorizedAt ? new Date(w.authorizedAt).getTime() + REFRESH_LIFETIME_MS : null;
  return {
    now: item && {
      ...item,
      playing: !!player.is_playing,
      progress: player.progress_ms || 0,
      device: String(player.device?.name || '').slice(0, 100),
    },
    recent,
    expiresAt: expires ? new Date(expires).toISOString() : null,
  };
}

// ---------- Connexion du compte ----------
const states = new Map(); // id du widget -> { value, t }

function startOAuth(w) {
  const value = crypto.randomBytes(16).toString('hex');
  states.set(w.id, { value, t: Date.now() });
  const q = new URLSearchParams({ response_type: 'code', client_id: w.username, scope: SCOPES, redirect_uri: REDIRECT_URI, state: value });
  return `${ACCOUNTS}/authorize?${q}`;
}

// `pasted` : l'adresse de retour recopiée. Renvoie le jeton de rafraîchissement.
async function finishOAuth(w, pasted) {
  let params;
  try {
    params = new URL(pasted).searchParams;
  } catch {
    throw fail('spotify_paste', 'Colle l\'adresse complète de la page de retour, qui commence par http://127.0.0.1');
  }
  if (params.get('error')) throw fail('spotify_denied', 'Autorisation refusée sur Spotify');
  const known = states.get(w.id);
  // Ce champ vérifie que l'autorisation vient bien de ce formulaire, et pas d'une adresse reçue d'ailleurs.
  if (!params.get('code') || !known || known.value !== params.get('state') || Date.now() - known.t > STATE_MS) {
    throw fail('spotify_paste', 'Adresse invalide ou trop ancienne : clique de nouveau sur « Autoriser »');
  }
  const t = await tokenRequest(w, { grant_type: 'authorization_code', code: params.get('code'), redirect_uri: REDIRECT_URI });
  if (!t?.refresh_token) throw fail('spotify_paste', 'Adresse invalide ou trop ancienne : clique de nouveau sur « Autoriser »');
  states.delete(w.id);
  return t.refresh_token;
}

module.exports = {
  spotify: {
    fields: ['username', 'password', 'apiKey'], userRequired: true, keep: ['authorizedAt'], cacheMs: 10_000, fetch: spotify,
    reset: () => { sessions.clear(); recents.clear(); },
    oauth: { start: startOAuth, finish: finishOAuth, redirectUri: REDIRECT_URI },
    // Visiteur non connecté : le titre en cours, pas l'historique d'écoute ni l'appareil.
    publicData: ({ now, recent, expiresAt, ...d }) => ({ ...d, now: now && { ...now, device: '' }, recent: [] }),
  },
};
