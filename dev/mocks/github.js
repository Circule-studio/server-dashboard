// Faux GitHub (API REST v3).

const { http, ago } = require('./lib');

// Sans jeton, demo/private répond 404 comme le vrai GitHub ; un mauvais jeton répond 401.
// Comme le vrai, il envoie un ETag et répond 304 à If-None-Match. Chaque requête est comptée dans la
// console (« GitHub : n requêtes ») pour vérifier que le dashboard ménage la limite.
// POST /__limit (réservé aux tests) simule la limite atteinte pendant 1 h ; un 2e appel la lève.
// POST /__limit?search ne limite que la recherche (issues et PR), qui a sa propre limite chez GitHub.
// demo/secondary répond toujours par la limite secondaire (retry-after de 30 s).
// Dates figées au lancement : une réponse identique garde le même ETag.
const ghStart = Date.now();
const ghAgo = (min) => new Date(ghStart - min * 60_000).toISOString();
let ghRequests = 0;
let ghLimitedUntil = 0;
let ghSearchLimitedUntil = 0;
const ghJson = (req, res, obj) => {
  const body = JSON.stringify(obj);
  const etag = `"${require('crypto').createHash('sha1').update(body).digest('hex')}"`;
  if (req.headers['if-none-match'] === etag) { console.log('GitHub : 304 inchangé'); res.writeHead(304, { ETag: etag }); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/json', ETag: etag });
  res.end(body);
};
const ghUser = (login) => ({ login });
const ghIssue = (number, title, created, labels = [], extra = {}) => ({
  number, title, html_url: `https://github.com/circule-studio/server-dashboard/issues/${number}`,
  user: ghUser('thomas370'), created_at: ago(created), comments: 2, labels, ...extra,
});
const GH_REPOS = {
  'circule-studio/server-dashboard': {
    private: false, stars: 214, releases: [
      ['v0.9.0-beta.1', 60 * 5, true], ['v0.8.0', 60 * 26], ['v0.7.0', 60 * 50], ['v0.6.1', 60 * 74], ['v0.6.0', 60 * 75],
    ], unreleased: 3,
    issues: [
      ghIssue(63, 'Nouveau widget : GitHub (suivre les versions et les issues d\'un projet)', 40, [{ name: 'widget', color: '0e8a16' }, { name: 'enhancement', color: 'a2eeef' }]),
      ghIssue(48, 'Un fichier par intégration (serveur, interface, faux service)', 60 * 50, [{ name: 'help wanted', color: '008672' }]),
      ghIssue(47, 'Garder la config en mémoire au lieu de relire config.json à chaque requête', 60 * 50),
      ghIssue(46, 'check-i18n : les clés écrites dans une condition ne sont pas vérifiées', 60 * 51, [{ name: 'good first issue', color: '7057ff' }]),
      ghIssue(45, 'Tester automatiquement les widgets en CI avec les faux services', 60 * 51),
    ], issueCount: 11,
    pulls: [
      ghIssue(64, 'Widget GitHub', 12, [], { draft: false }),
      ghIssue(60, 'Thème : couleurs d\'accent personnalisées', 60 * 30, [], { draft: true }),
    ], pullCount: 2,
  },
  'demo/private': { private: true, stars: 0, releases: [['1.2.0', 60 * 24 * 9]], unreleased: 0, issues: [], issueCount: 0, pulls: [], pullCount: 0, token: true },
  'demo/tags-only': { private: false, stars: 7, releases: [], tags: ['v2.9.0', 'v2.10.0', 'v2.1.0'], unreleased: 12, issues: [], issueCount: 0, pulls: [], pullCount: 0 },
  'demo/empty': { private: false, stars: 0, releases: [], tags: [], empty: true, issues: [], issueCount: 0, pulls: [], pullCount: 0 },
};
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/__limit')) {
    const search = req.url.endsWith('?search');
    const until = (search ? ghSearchLimitedUntil : ghLimitedUntil) > Date.now() ? 0 : Date.now() + 60 * 60_000;
    if (search) ghSearchLimitedUntil = until; else ghLimitedUntil = until;
    console.log(`GitHub : limite${search ? ' de la recherche' : ''} ${until ? 'simulée pendant 1 h' : 'levée'}`);
    res.writeHead(204); return res.end();
  }
  console.log(`GitHub : ${++ghRequests} requêtes (${req.url.split('?')[0]})`);
  const auth = req.headers.authorization;
  if (auth && auth !== 'Bearer gh-token') { res.writeHead(401); return res.end(); }
  const u = new URL(req.url, 'http://x');
  const limit = u.pathname.startsWith('/search/') ? ghSearchLimitedUntil : ghLimitedUntil;
  if (limit > Date.now()) {
    res.writeHead(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(limit / 1000)) });
    return res.end('{"message":"API rate limit exceeded"}');
  }
  if (u.pathname.startsWith('/repos/demo/secondary')) {
    res.writeHead(403, { 'retry-after': '30', 'x-ratelimit-remaining': '41', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3000) });
    return res.end('{"message":"You have exceeded a secondary rate limit."}');
  }
  const notFound = () => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"Not Found"}'); };
  if (u.pathname.startsWith('/repos/demo/rate-limited') || u.searchParams.get('q')?.includes('demo/rate-limited')) {
    res.writeHead(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 25 * 60) });
    return res.end('{"message":"API rate limit exceeded"}');
  }
  if (u.pathname === '/search/issues') {
    const q = u.searchParams.get('q') || '';
    const name = (q.match(/repo:(\S+)/) || [])[1];
    const r = GH_REPOS[name];
    if (!r || (r.token && !auth)) { res.writeHead(422); return res.end('{"message":"Validation Failed"}'); }
    const pr = q.includes('is:pr');
    return ghJson(req, res, { total_count: pr ? r.pullCount : r.issueCount, incomplete_results: false, items: pr ? r.pulls : r.issues });
  }
  const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  const r = m && GH_REPOS[m[1]];
  if (!r || (r.token && !auth)) return notFound();
  const html = `https://github.com/${m[1]}`;
  const rest = m[2] || '';
  if (!rest) return ghJson(req, res, {
    full_name: m[1], html_url: html, private: r.private, archived: false, default_branch: 'main',
    stargazers_count: r.stars, forks_count: Math.round(r.stars / 9), pushed_at: ghAgo(35),
  });
  if (rest === '/releases') return ghJson(req, res, r.releases.map(([tag, min, pre]) => ({
    tag_name: tag, name: tag, published_at: ghAgo(min), prerelease: !!pre, draft: false, html_url: `${html}/releases/tag/${tag}`,
  })));
  if (rest === '/tags') return ghJson(req, res, (r.tags || []).map((name) => ({ name })));
  if (rest === '/commits') {
    if (r.empty) { res.writeHead(409); return res.end('{"message":"Git Repository is empty."}'); }
    return ghJson(req, res, [{
      sha: '3f9c2a17b4e8d0c6a5f1e2d3c4b5a69788776655', html_url: `${html}/commit/3f9c2a1`,
      author: ghUser('thomas370'), commit: { message: 'Widget GitHub : versions, issues et PR\n\nDétails…', committer: { date: ghAgo(35) } },
    }]);
  }
  if (rest.startsWith('/compare/')) return ghJson(req, res, { status: r.unreleased ? 'ahead' : 'identical', ahead_by: r.unreleased, behind_by: 0, commits: [] });
  notFound();
}).listen(14000);
