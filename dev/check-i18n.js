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

// Clés écrites en toutes lettres…
const used = new Set([...app.matchAll(/\bt\('([\w.-]+)'/g)].map((m) => m[1]));
for (const m of app.matchAll(/(?:keyLabel|keyHelp|userLabel|userHelp): '([\w.]+)'/g)) used.add(m[1]);
for (const m of html.matchAll(/data-i18n(?:-html|-placeholder|-title|-aria)?="([\w.-]+)"/g)) used.add(m[1]);
// … et clés construites dynamiquement dans app.js.
const dynamic = {
  'stat.': ['movies', 'series', 'episodes', 'libraries', 'streams'],
  'arr.release.': ['cinema', 'digital', 'physical'],
  'pulse.verdict.': ['ok', 'attention', 'critical', 'stale', 'off'],
  'pulse.sec.': ['health', 'alerts', 'resources', 'health.short', 'alerts.short', 'resources.short'],
  'pulse.': ['nodes.one', 'nodes.other', 'containers.one', 'containers.other', 'docker.one', 'docker.other'],
};
for (const [prefix, names] of Object.entries(dynamic)) for (const n of names) used.add(prefix + n);

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
const serverCodes = new Set([...`${read('server.js')}\n${read('integrations.js')}`.matchAll(/(?:fail\(|code: )'([a-z_]+)'/g)].map((m) => m[1]));
for (const code of serverCodes) {
  for (const lang of langs) {
    if (!(`err.${code}` in ctx.I18N[lang])) { errors++; console.error(`[${lang}] code serveur non traduit : err.${code}`); }
  }
}

if (errors) process.exit(1);
console.log(`Traductions OK : ${langs.join(', ')} · ${Object.keys(ctx.I18N[langs[0]]).length} clés · ${used.size} utilisées · ${serverCodes.size} codes serveur`);
