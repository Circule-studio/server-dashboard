// Vérifie que chaque nom d'icône (catalogue d'applications, widgets) existe sur dashboardicons.com,
// en SVG ou à défaut en PNG (le même repli que l'interface). Lancé par la CI (.github/workflows/icons.yml).
//   node dev/check-icons.js
// ICONS_BASE remplace l'adresse du dépôt d'icônes (tests).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const BASE = (process.env.ICONS_BASE || 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons').replace(/\/+$/, '');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(`${fs.readFileSync(path.join(root, 'public/catalog.js'), 'utf8')}\nthis.APP_CATALOG = APP_CATALOG;`, ctx);
const names = new Map(); // nom -> où il est utilisé
const use = (name, where) => names.set(name, [...(names.get(name) || []), where]);
for (const app of ctx.APP_CATALOG) use(app.icon, `catalogue (${app.name})`);
const widgetsDir = path.join(root, 'public/widgets');
for (const file of fs.readdirSync(widgetsDir).filter((f) => f.endsWith('.js'))) {
  // Les icônes du dépôt (/icons/…) ne sont pas sur dashboardicons.com.
  for (const m of fs.readFileSync(path.join(widgetsDir, file), 'utf8').matchAll(/\bicon: '([a-z0-9-]+)'/g)) use(m[1], `widget ${file}`);
}

async function exists(url) {
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
  return res.ok;
}

(async () => {
  const missing = [];
  const queue = [...names.keys()];
  // 8 vérifications à la fois : assez rapide, sans abuser du CDN.
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const name = queue.shift();
      if (!(await exists(`${BASE}/svg/${name}.svg`)) && !(await exists(`${BASE}/png/${name}.png`))) missing.push(name);
    }
  })).catch((e) => {
    console.error(`Dépôt d'icônes injoignable (${e.cause?.code || e.message}) : vérification impossible.`);
    process.exit(2);
  });
  if (missing.length) {
    for (const name of missing.sort()) console.error(`Icône introuvable : « ${name} » (${names.get(name).join(', ')})`);
    console.error('Cherche le bon nom sur https://dashboardicons.com');
    process.exit(1);
  }
  console.log(`Icônes OK : ${names.size} noms vérifiés`);
})();
