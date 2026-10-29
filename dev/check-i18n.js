// Vérifie les traductions : chaque clé utilisée existe dans toutes les langues,
// et toutes les langues ont exactement les mêmes clés. Lancé par la CI.
//   node dev/check-i18n.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const ctx = { navigator: { language: 'fr' }, localStorage: { getItem: () => null }, document: {}, location: {} };
vm.createContext(ctx);
vm.runInContext(`${read('public/i18n.js')}\nthis.I18N = I18N;`, ctx);
const langs = Object.keys(ctx.I18N);
const app = read('public/app.js');
const html = read('public/index.html');

// Clés écrites en toutes lettres : toute chaîne 'espace.nom' de app.js dont l'espace existe
// (widget., github.…), où qu'elle soit écrite : t('clé'), keyLabel: 'clé', t(cond ? 'clé.a' : 'clé.b')…
// Les chaînes passées à t() ou tp() comptent même si leur espace est inconnu (faute de frappe).
const namespaces = new Set(Object.keys(ctx.I18N[langs[0]]).map((k) => k.split('.')[0]));
const used = new Set();
const plurals = new Set(); // bases de tp('clé', n) : clé.one et clé.other
for (const m of app.matchAll(/'([a-z][\w-]*\.[\w.-]*[\w-])'/g)) if (namespaces.has(m[1].split('.')[0])) used.add(m[1]);
for (const m of app.matchAll(/\bt\('([\w.-]+)'/g)) used.add(m[1]);
for (const m of app.matchAll(/\btp\('([\w.-]+)'/g)) plurals.add(m[1]);
for (const m of html.matchAll(/data-i18n(?:-html|-placeholder|-title|-aria)?="([\w.-]+)"/g)) used.add(m[1]);
// … et clés construites dynamiquement dans app.js.
const dynamic = {
  'stat.': ['movies', 'series', 'episodes', 'libraries', 'streams'],
  'arr.release.': ['cinema', 'digital', 'physical'],
  'pulse.verdict.': ['ok', 'attention', 'critical', 'stale', 'off'],
  'pulse.sec.': ['health', 'alerts', 'resources', 'health.short', 'alerts.short', 'resources.short'],
  'dns.': ['enabled', 'disabled', 'failed', 'unknown', 'blocklist.one', 'blocklist.other', 'clients.one', 'clients.other'],
  'weather.code.': [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99],
  'github.sec.': ['version', 'issues', 'pulls', 'version.short', 'issues.short', 'pulls.short'],
};
for (const [prefix, names] of Object.entries(dynamic)) for (const n of names) used.add(prefix + n);
// Une base de pluriel n'est pas une clé : on vérifie ses deux formes.
for (const base of [...used].filter((k) => plurals.has(k))) used.delete(base);
for (const base of plurals) used.add(`${base}.one`).add(`${base}.other`);

let errors = 0;
for (const lang of langs) {
  const keys = ctx.I18N[lang];
  const missing = [...used].filter((k) => !(k in keys));
  if (missing.length) { errors++; console.error(`[${lang}] clés manquantes : ${missing.join(', ')}`); }
  for (const other of langs) {
    const extra = Object.keys(keys).filter((k) => !(k in ctx.I18N[other]));
    if (extra.length) { errors++; console.error(`[${lang}] clés absentes de « ${other} » : ${extra.join(', ')}`); }
  }
}
// Les codes d'erreur renvoyés par le serveur doivent être traduits.
const serverCodes = new Set([...`${read('server.js')}\n${read('integrations.js')}`.matchAll(/(?:fail\(|code: |forbidden: )'([a-z_]+)'/g)].map((m) => m[1]));
for (const code of serverCodes) {
  for (const lang of langs) {
    if (!(`err.${code}` in ctx.I18N[lang])) { errors++; console.error(`[${lang}] code serveur non traduit : err.${code}`); }
  }
}

// Catalogue d'applications : chaque entrée complète, avec sa description dans toutes les langues.
vm.runInContext(`${read('public/catalog.js')}\nthis.APP_CATALOG = APP_CATALOG;`, ctx);
const seenApps = new Set();
for (const a of ctx.APP_CATALOG) {
  const problems = [];
  if (!a.name || seenApps.has(a.name.toLowerCase())) problems.push('nom absent ou en double');
  if (!/^[a-z0-9-]+$/.test(a.icon || '')) problems.push('icône invalide');
  if (!Number.isInteger(a.port) || a.port < 1 || a.port > 65535) problems.push('port invalide');
  if (a.scheme && !['http', 'https'].includes(a.scheme)) problems.push('scheme invalide');
  if (a.path && !a.path.startsWith('/')) problems.push('path doit commencer par /');
  for (const lang of langs) if (!a[lang]) problems.push(`description « ${lang} » manquante`);
  if (problems.length) { errors++; console.error(`[catalogue] ${a.name || '?'} : ${problems.join(', ')}`); }
  seenApps.add((a.name || '').toLowerCase());
}

if (errors) process.exit(1);
console.log(`Traductions OK : ${langs.join(', ')} · ${Object.keys(ctx.I18N[langs[0]]).length} clés · ${used.size} utilisées · ${serverCodes.size} codes serveur · ${ctx.APP_CATALOG.length} apps au catalogue`);
