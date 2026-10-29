// GitHub.
// `repo` : propriétaire/dépôt (normalisé par server.js). Jeton facultatif : obligatoire pour un
// dépôt privé, il relève aussi la limite de GitHub (60 requêtes par heure et par IP sans jeton).
// `url` : facultative, API d'un GitHub Enterprise (https://github.exemple.fr/api/v3) ou faux service.

const crypto = require('crypto');
const { request, fail, join } = require('./lib');

const GITHUB_API = 'https://api.github.com';
const SECTIONS = ['version', 'issues', 'pulls'];

// Lien affiché dans l'interface : seulement une adresse web (pas de javascript: venant de l'API).
const webUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

// Pour ménager la limite de GitHub :
// - chaque réponse est gardée avec son ETag et redemandée avec If-None-Match : une réponse
//   « 304 inchangé » ne compte pas dans la limite quand un jeton est utilisé ;
// - une réponse de moins de GITHUB_SHARE_MS est réutilisée telle quelle : deux widgets sur le
//   même dépôt (un bloc Version, un bloc Issues) ne font pas deux fois les mêmes requêtes ;
// - une fois la limite atteinte, plus aucune requête jusqu'à l'heure de reprise annoncée par GitHub.
// Ces mémoires ne dépendent que du jeton et de l'adresse : elles survivent aux changements de config
// (sinon chaque enregistrement coûterait une requête complète par widget) et sont purgées par âge.
const GITHUB_SHARE_MS = 60_000;
const GITHUB_KEEP_MS = 2 * 3600_000;
const githubResponses = new Map(); // `${jeton}|${url}` -> { t, etag, status, json, pending }
const githubLimits = new Map(); // `${jeton}|${API}|${core ou search}` -> heure de reprise (ms)
let githubPruned = 0;

function githubPrune() {
  const now = Date.now();
  if (now - githubPruned < 10 * 60_000) return;
  githubPruned = now;
  for (const [k, e] of githubResponses) if (!e.pending && now - e.t > GITHUB_KEEP_MS) githubResponses.delete(k);
  for (const [k, until] of githubLimits) if (until < now) githubLimits.delete(k);
  for (const [k, e] of githubLast) if (now - e.t > GITHUB_KEEP_MS) githubLast.delete(k);
  if (githubCompares.size > 500) githubCompares.clear();
}

const githubIdentity = (w) => (w.apiKey ? crypto.createHash('sha256').update(w.apiKey).digest('hex').slice(0, 16) : 'anonyme');

function githubLimited(until) {
  return fail('github_rate_limit', 'Limite de requêtes GitHub atteinte', { minutes: Math.max(1, Math.ceil((until - Date.now()) / 60_000)) });
}

// Heure de reprise si la réponse signale une limite, sinon null. Limite secondaire (trop de requêtes
// rapprochées) : retry-after prime sur x-ratelimit-reset, qui est la fin de la fenêtre d'une heure.
function githubLimitUntil(r) {
  if (r.status !== 403 && r.status !== 429) return null;
  const retryAfter = Number(r.headers['retry-after']);
  if (retryAfter > 0) return Date.now() + retryAfter * 1000;
  if (r.headers['x-ratelimit-remaining'] === '0') return Number(r.headers['x-ratelimit-reset']) * 1000 || Date.now() + 60_000;
  // Limite secondaire sans en-tête : GitHub conseille d'attendre au moins une minute.
  if (/rate limit/i.test(r.json?.message || '')) return Date.now() + 60_000;
  return null;
}

async function githubFetch(w, url, limitKey, known, maxBytes) {
  const reset = githubLimits.get(limitKey);
  if (reset > Date.now()) throw githubLimited(reset);
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'server-dashboard' };
  if (w.apiKey) headers.Authorization = `Bearer ${w.apiKey}`;
  if (known?.etag) headers['If-None-Match'] = known.etag;
  // Certificat vérifié pour github.com : le jeton ne doit partir que vers le vrai GitHub. Une URL
  // personnalisée (GitHub Enterprise interne) garde le comportement des autres services.
  const r = await request(url, { headers, maxBytes, verifyTls: !w.url });
  const until = githubLimitUntil(r);
  if (until) {
    githubLimits.set(limitKey, until);
    throw githubLimited(until);
  }
  if (r.status === 304 && known) return { status: known.status, json: known.json, etag: known.etag };
  return { status: r.status, json: r.json, etag: (r.status === 200 && r.headers.etag) || null };
}

// `optional` : codes HTTP qui veulent dire « rien à afficher » (ex. 409 pour un dépôt vide) -> null.
// `store: false` : réponse ni gardée ni partagée (déjà mémorisée ailleurs, ou volumineuse).
async function githubGet(w, path, { optional = [], store = true, maxBytes } = {}) {
  githubPrune();
  const api = w.url || GITHUB_API;
  const url = join(api, path);
  const id = githubIdentity(w);
  const limitKey = `${id}|${api}|${path.startsWith('/search/') ? 'search' : 'core'}`;
  let r;
  if (!store) {
    r = await githubFetch(w, url, limitKey, null, maxBytes);
  } else {
    const key = `${id}|${url}`;
    let entry = githubResponses.get(key);
    if (!entry?.pending && !(entry && Date.now() - entry.t < GITHUB_SHARE_MS)) {
      const pending = githubFetch(w, url, limitKey, entry, maxBytes);
      entry = { ...entry, pending };
      githubResponses.set(key, entry);
      try {
        entry = { t: Date.now(), ...(await pending) };
        githubResponses.set(key, entry);
      } catch (e) {
        githubResponses.set(key, { ...entry, pending: null, t: 0 });
        throw e;
      }
    }
    r = entry.pending ? await entry.pending : entry;
  }
  if (optional.includes(r.status)) return null;
  if (r.status === 401) throw fail('github_token', 'Jeton GitHub refusé');
  // GitHub répond 404 aussi pour un dépôt privé quand le jeton manque ou n'y a pas accès.
  if (r.status === 404) throw fail('github_not_found', `Dépôt GitHub introuvable : ${w.repo}`, { repo: w.repo });
  if (r.status === 403) throw fail('github_forbidden', 'Accès refusé par GitHub');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

// Commits entre une version et un commit : ne change jamais, calculé une seule fois.
const githubCompares = new Map(); // `${API}|${dépôt}|${tag}|${sha}` -> nombre de commits (ou null)

async function githubUnreleased(w, tag, sha) {
  const key = `${w.url || GITHUB_API}|${w.repo}|${tag}|${sha}`;
  if (!githubCompares.has(key)) {
    let ahead = null;
    try {
      // La réponse contient aussi la liste des fichiers modifiés : elle peut être lourde quand la
      // version est ancienne. Trop lourde ou trop lente : le nombre reste inconnu, sans erreur.
      const cmp = await githubGet(w, `/repos/${w.repo}/compare/${encodeURIComponent(tag)}...${sha}?per_page=1`,
        { optional: [404, 422], store: false, maxBytes: 4 * 1024 * 1024 });
      ahead = cmp?.ahead_by ?? null;
    } catch (e) {
      if (e.key !== 'response_too_large' && e.key !== 'timeout') throw e;
    }
    githubCompares.set(key, ahead);
  }
  return githubCompares.get(key);
}

// Tags triés par numéro de version : l'API les trie par nom (v1.9.0 avant v1.10.0).
const byVersion = (a, b) => b.localeCompare(a, 'en', { numeric: true });

async function githubVersion(w, repo) {
  const base = `/repos/${w.repo}`;
  const [releases, commits] = await Promise.all([
    githubGet(w, `${base}/releases?per_page=6`),
    githubGet(w, `${base}/commits?per_page=1&sha=${encodeURIComponent(repo.branch)}`, { optional: [404, 409] }), // 409 : dépôt vide
  ]);
  let list = releases.filter((r) => !r.draft).map((r) => ({
    tag: r.tag_name, name: r.name || r.tag_name, date: r.published_at || r.created_at, prerelease: !!r.prerelease, url: webUrl(r.html_url),
  }));
  // Pas de release : on se rabat sur les tags (sans date dans cette route).
  if (!list.length) {
    const tags = (await githubGet(w, `${base}/tags?per_page=100`, { optional: [404, 409] })) || [];
    list = tags.map((tg) => tg.name).sort(byVersion).slice(0, 5).map((tag) => ({
      tag, name: tag, date: null, prerelease: false,
      url: repo.url && `${repo.url}/releases/tag/${encodeURIComponent(tag)}`,
    }));
  }
  // Comme GitHub, la « dernière version » est la plus récente qui n'est pas une pré-release.
  const latest = list.find((r) => !r.prerelease) || list[0] || null;
  const at = list.indexOf(latest);
  const c = commits?.[0];
  return {
    latest,
    unreleased: latest && c ? await githubUnreleased(w, latest.tag, c.sha) : null,
    // Pré-release plus récente que la dernière version (ex. une bêta en cours), et versions précédentes.
    prerelease: at > 0 ? list[0] : null,
    previous: list.slice(at + 1, at + 5),
    branch: repo.branch,
    commit: c ? {
      sha: c.sha.slice(0, 7),
      message: (c.commit?.message || '').split('\n')[0],
      author: c.author?.login || c.commit?.author?.name || '',
      date: c.commit?.committer?.date || c.commit?.author?.date,
      url: webUrl(c.html_url),
    } : null,
  };
}

// Recherche plutôt que /issues : le nombre est exact et ne mélange pas issues et PR, en une requête.
async function githubSearch(w, kind) {
  const q = encodeURIComponent(`repo:${w.repo} is:${kind} is:open`);
  const r = await githubGet(w, `/search/issues?q=${q}&sort=created&order=desc&per_page=5`);
  return {
    total: r.total_count ?? 0,
    items: (r.items || []).map((i) => ({
      number: i.number,
      title: i.title,
      url: webUrl(i.html_url),
      author: i.user?.login || '',
      date: i.created_at,
      draft: !!i.draft,
      // Couleur validée : elle finit dans un attribut style.
      labels: (i.labels || []).slice(0, 3).map((l) => ({ name: l.name, color: /^[0-9a-f]{6}$/i.test(l.color) ? l.color : null })),
    })),
  };
}

async function githubRepoInfo(w) {
  const repo = await githubGet(w, `/repos/${w.repo}`);
  return {
    name: repo.full_name, url: webUrl(repo.html_url), branch: repo.default_branch,
    stars: repo.stargazers_count ?? 0, forks: repo.forks_count ?? 0,
    private: !!repo.private, archived: !!repo.archived, pushed: repo.pushed_at,
  };
}

// Dernières données complètes reçues par widget. Quand la limite est atteinte, chaque partie
// concernée (infos du dépôt, version, issues, PR) reprend ses dernières données, avec un
// avertissement ; les autres restent à jour (la recherche a sa propre limite, par exemple).
const githubLast = new Map(); // id du widget -> { sig, t, data }

async function github(w) {
  if (!w.repo) throw fail('github_repo_invalid', 'Dépôt manquant', { repo: '' });
  const sections = w.sections?.length ? w.sections : SECTIONS;
  const sig = JSON.stringify([w.url, w.repo, sections, githubIdentity(w)]);
  const prev = githubLast.get(w.id)?.sig === sig ? githubLast.get(w.id) : null;
  let limited = null;
  const part = (name, promise) => promise.catch((e) => {
    if (e.key !== 'github_rate_limit' || !prev?.data[name]) throw e;
    limited = e;
    return prev.data[name];
  });
  const out = { sections, repo: await part('repo', githubRepoInfo(w)) };
  // Seuls les blocs choisis sont demandés : ça ménage la limite de requêtes.
  await Promise.all([
    sections.includes('version') && part('version', githubVersion(w, out.repo)).then((v) => { out.version = v; }),
    sections.includes('issues') && part('issues', githubSearch(w, 'issue')).then((v) => { out.issues = v; }),
    sections.includes('pulls') && part('pulls', githubSearch(w, 'pr')).then((v) => { out.pulls = v; }),
  ]);
  if (!limited) githubLast.set(w.id, { sig, t: Date.now(), data: out });
  else out.limited = { since: new Date(prev.t).toISOString(), minutes: limited.params.minutes };
  return out;
}

module.exports = {
  // Sans jeton, 60 requêtes par heure : 3 par rafraîchissement, d'où un cache de 15 min.
  // Les mémoires de GitHub (ETag, limites) survivent aux changements de config : pas de reset.
  github: {
    fields: ['repo', 'apiKey', 'url'], sections: SECTIONS,
    cacheMs: (w) => (w.apiKey ? 2 * 60_000 : 15 * 60_000), fetch: github,
  },
};
