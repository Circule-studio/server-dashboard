// Validation de la config reçue (PUT /api/config, import) et version envoyée au navigateur.
// Tout ce qui arrive du navigateur passe par sanitizeConfig() : types vérifiés, longueurs bornées,
// identifiants uniques, secrets conservés quand le champ est laissé vide.

const crypto = require('crypto');
const { INTEGRATIONS } = require('./integrations');
const { fail } = require('./integrations/lib');
const { NOTIFY_TYPES } = require('./notify');
const { sanitizeCheck } = require('./checks');

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const SECRET_FIELDS = ['apiKey', 'password'];

function checkUrl(url) {
  if (url && !/^https?:\/\//i.test(url)) throw fail('invalid_url', `URL invalide : ${url}`, { url });
  return url;
}

// Dépôt GitHub : « propriétaire/dépôt », ou une adresse copiée (https://github.com/propriétaire/dépôt/issues,
// github.com/propriétaire/dépôt, git@github.com:propriétaire/dépôt.git…), ramenée à « propriétaire/dépôt ».
function githubRepo(value) {
  const path = value
    .replace(/^[a-z+]+:\/\/[^/]+/i, '') // https://github.com, ssh://git@github.com
    .replace(/^git@[^:/]+:/i, '')
    .replace(/^\/+/, '')
    .replace(/^[^/]*\.[^/]*\//, ''); // hôte sans « https:// » : un propriétaire GitHub n'a pas de point
  const [owner = '', name = ''] = path.split(/[/?#]/);
  const repo = `${owner}/${name.replace(/\.git$/i, '')}`;
  // Noms autorisés par GitHub ; « . » et « .. » sont exclus (ils changeraient le chemin de l'API).
  if (!/^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/.test(repo)) throw fail('github_repo_invalid', `Dépôt invalide : ${value}`, { repo: value });
  return repo;
}

// Page de statut Uptime Kuma : son nom (slug), ou l'adresse de la page collée dans l'URL
// (http://IP:3001/status/maison, aussi derrière un chemin de reverse proxy) dont on tire l'URL et le nom.
function statusPage(url, slug) {
  const pasted = url.match(/^(https?:\/\/.+?)\/status\/([^/?#]+)\/?(?:[?#].*)?$/i);
  const out = { url: pasted ? pasted[1] : url, slug: slug || (pasted ? pasted[2] : '') };
  if (!/^[a-z0-9-]{1,100}$/i.test(out.slug)) throw fail('kuma_slug_invalid', `Page de statut invalide : ${out.slug}`, { slug: out.slug });
  return out;
}

// Entités Home Assistant : « domaine.nom » (sensor.salon_temperature), une par ligne ou séparées
// par des virgules dans le formulaire. Sans doublon, 30 au plus.
const MAX_ENTITIES = 30;

function sanitizeEntities(list) {
  const raw = Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/);
  const entities = [...new Set(raw.map((e) => str(e, 255).toLowerCase()).filter(Boolean))];
  const invalid = entities.find((e) => !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(e));
  if (invalid) throw fail('ha_entity_invalid', `Entité invalide : ${invalid}`, { entity: invalid });
  if (!entities.length) throw fail('ha_entities_missing', 'Aucune entité choisie');
  if (entities.length > MAX_ENTITIES) throw fail('ha_too_many', `${MAX_ENTITIES} entités au plus`, { max: MAX_ENTITIES });
  return entities;
}

// Adresses de flux (RSS / Atom) : une par ligne, http(s), sans doublon.
const MAX_FEEDS = 10;
function sanitizeFeeds(list) {
  const raw = Array.isArray(list) ? list : String(list || '').split(/\s+/);
  const feeds = [...new Set(raw.map((u) => str(u, 2000)).filter(Boolean))].map(checkUrl);
  if (!feeds.length) throw fail('feeds_missing', 'Aucun flux');
  if (feeds.length > MAX_FEEDS) throw fail('feeds_too_many', `${MAX_FEEDS} flux au plus`, { max: MAX_FEEDS });
  return feeds;
}

// API personnalisée : valeurs à afficher, une par ligne « chemin | libellé | format » (texte saisi)
// ou objets { path, label, format } (config enregistrée, import).
const MAX_MAPPINGS = 12;
const MAPPING_FORMATS = {
  text: 'text', texte: 'text', number: 'number', nombre: 'number', percent: 'percent', pourcentage: 'percent',
  bytes: 'bytes', octets: 'bytes', rate: 'rate', debit: 'rate', 'débit': 'rate', date: 'date',
};

function sanitizeMappings(input) {
  const lines = Array.isArray(input) ? input : String(input || '').split('\n');
  const out = [];
  lines.forEach((line, i) => {
    const [path, label, format] = typeof line === 'string'
      ? line.split('|').map((x) => x.trim())
      : [line?.path, line?.label, line?.format].map((x) => str(x, 100));
    if (!path) return; // ligne vide
    const fmt = format ? MAPPING_FORMATS[format.toLowerCase()] : 'text';
    if (!/^[\w$-]+(\.[\w$-]+)*$/.test(path) || path.length > 200 || !fmt) {
      throw fail('mapping_invalid', `Ligne ${i + 1} invalide`, { line: i + 1 });
    }
    out.push({ path, label: str(label, 60), format: fmt });
  });
  if (!out.length) throw fail('mappings_missing', 'Aucune valeur à afficher');
  if (out.length > MAX_MAPPINGS) throw fail('mappings_too_many', `${MAX_MAPPINGS} valeurs au plus`, { max: MAX_MAPPINGS });
  return out;
}

// Élément d'une liste de la config : un null, un nombre ou un tableau est refusé proprement
// (avant, l'erreur JavaScript brute était renvoyée au navigateur).
function item(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail('bad_request', 'Élément invalide dans la configuration');
  return v;
}

// Identifiant unique dans la liste : absent ou déjà vu, il est remplacé. Les données des
// widgets et le statut des apps sont rangés par identifiant : un doublon mélangeait les deux.
function uniqueId(seen, raw, prefix) {
  let id = str(raw, 64);
  if (!id || seen.has(id)) id = `${prefix}-${crypto.randomUUID()}`;
  seen.add(id);
  return id;
}

// Nom d'un drapeau lié à un secret : flag('has', 'apiKey') -> 'hasApiKey', flag('clear', 'password') -> 'clearPassword'.
const flag = (prefix, field) => `${prefix}${field[0].toUpperCase()}${field.slice(1)}`;

// Champs facultatifs d'un widget, présents selon son intégration (`fields`) : nom -> validation.
const OPTIONAL_FIELDS = {
  location: (w) => str(w.location, 200), // météo : nom de ville ou coordonnées
  indexerUrl: (w) => checkUrl(str(w.indexerUrl, 2000)), // deuxième adresse facultative (indexer Wazuh)
  query: (w) => str(w.query, 500), // sélecteur LogQL
  entities: (w) => sanitizeEntities(w.entities),
  feeds: (w) => sanitizeFeeds(w.feeds),
  mappings: (w) => sanitizeMappings(w.mappings),
};

// `previous` sert à conserver les secrets : le navigateur ne les reçoit jamais,
// donc un champ vide signifie « inchangé ».
function sanitizeWidgets(list, previous = []) {
  const seen = new Set();
  const occurrences = new Map(); // identifiant reçu -> nombre de fois déjà vu
  return (Array.isArray(list) ? list : []).map(item).map((w) => {
    const type = str(w.type, 32);
    const def = INTEGRATIONS[type];
    if (!def) throw fail('bad_request', `Type de widget inconnu : ${type}`);
    const has = (field) => def.fields.includes(field);
    const raw = str(w.id, 64);
    const id = uniqueId(seen, raw, 'wid');
    // Doublon venu d'un config.json modifié à la main : le n-ième garde les secrets du n-ième.
    const n = occurrences.get(raw) || 0;
    occurrences.set(raw, n + 1);
    // Même type seulement : la clé d'un ancien widget Sonarr ne doit pas partir vers un Radarr.
    const old = (raw && previous.filter((p) => p.id === raw)[n]) || {};
    if (old.type && old.type !== type) for (const f of SECRET_FIELDS) delete old[f];
    const out = { id, type, name: str(w.name, 100) || type, url: checkUrl(str(w.url, 2000)) };
    // Le nom d'utilisateur n'est envoyé qu'aux admins : absent de la requête = inchangé.
    if (has('username')) {
      out.username = typeof w.username === 'string' ? str(w.username, 200) : old.username || '';
      if (def.userRequired && !out.username) throw fail('username_required', `Utilisateur obligatoire (${type})`, { type });
    }
    // Case « M'alerter » : notifications sur l'état signalé par le widget (ex. VM Proxmox arrêtée).
    if (def.alerts) out.alert = w.alert === true;
    for (const [field, clean] of Object.entries(OPTIONAL_FIELDS)) if (has(field)) out[field] = clean(w);
    if (has('slug')) Object.assign(out, statusPage(out.url, str(w.slug, 100)));
    if (has('repo')) {
      out.repo = githubRepo(str(w.repo, 300));
      // Nom par défaut : le dépôt normalisé (le navigateur affiche le type en attendant l'enregistrement).
      if (!str(w.name, 100)) out.name = out.repo;
    }
    // Blocs à afficher, pour les intégrations qui en proposent (ex. Pulse).
    if (def.sections) {
      const chosen = (Array.isArray(w.sections) ? w.sections : []).filter((s) => def.sections.includes(s));
      out.sections = chosen.length ? [...new Set(chosen)] : [...def.sections];
    }
    for (const k of def.keep || []) if (old[k]) out[k] = old[k];
    // Jeton créé par le serveur (agent) : jamais saisi, gardé d'un enregistrement à l'autre.
    // regenerateKey : nouveau jeton demandé (l'ancien cesse de marcher).
    if (def.generatedKey) {
      out.apiKey = (w.regenerateKey !== true && old.apiKey) || crypto.randomBytes(24).toString('base64url');
    }
    for (const f of SECRET_FIELDS) {
      if (!has(f)) continue;
      // Vide = inchangé ; clearApiKey / clearPassword = effacer (ex. Pi-hole sans mot de passe).
      out[f] = w[flag('clear', f)] === true ? '' : str(w[f], 2000) || old[f] || ''; // 2000 : plusieurs adresses iCal secrètes
    }
    return out;
  });
}

// Version envoyée au navigateur : jamais de clés API ni de mots de passe,
// et les noms d'utilisateur seulement pour un admin connecté.
function publicConfig(cfg, authed) {
  const { notify, ...rest } = cfg;
  return {
    ...rest,
    // Notifications : réglage visible des admins seulement, sans l'URL ni le jeton.
    ...(authed && notify ? { notify: { type: notify.type, lang: notify.lang, hasUrl: !!notify.url, hasToken: !!notify.token } } : {}),
    widgets: cfg.widgets.map((w) => {
      const pub = { ...w };
      for (const f of SECRET_FIELDS) {
        if (f in pub) { pub[flag('has', f)] = !!pub[f]; delete pub[f]; }
      }
      if (!authed) delete pub.username;
      return pub;
    }),
  };
}

// Éléments de la barre du haut que l'admin peut masquer (tous visibles par défaut).
const DISPLAY_OPTIONS = ['search', 'theme', 'lang'];

// Notifications. `url` et `token` sont des secrets : vides = inchangés (si le type ne change pas),
// clearToken = effacer le jeton. Sans type : désactivées.
function sanitizeNotify(input, previous) {
  if (input === undefined) return previous || { type: '' }; // ancienne interface : inchangées
  const src = input && typeof input === 'object' ? input : {};
  const type = NOTIFY_TYPES.includes(src.type) ? src.type : '';
  if (!type) return { type: '' };
  const same = previous?.type === type ? previous : {};
  const out = {
    type,
    lang: src.lang === 'en' ? 'en' : 'fr',
    url: checkUrl(str(src.url, 2000)) || same.url || '',
    token: src.clearToken === true ? '' : str(src.token, 500) || same.token || '',
  };
  if (!out.url) throw fail('notify_url_missing', 'URL de notification manquante');
  // ntfy : l'adresse du sujet (https://ntfy.sh/mon-sujet), pas seulement celle du serveur.
  let pathname;
  try { ({ pathname } = new URL(out.url)); } catch { throw fail('invalid_url', `URL invalide : ${out.url}`, { url: out.url }); }
  if (type === 'ntfy' && pathname.replace(/\/+$/, '') === '') throw fail('notify_topic_missing', 'Sujet ntfy manquant');
  if (type === 'gotify' && !out.token) throw fail('notify_token_missing', 'Jeton Gotify manquant');
  return out;
}

// Taille des tuiles d'apps (réglage global).
const TILE_SIZES = ['compact', 'normal', 'large'];
// Recherche web de la recherche rapide (#91) : un moteur proposé, « none », ou une adresse
// personnalisée (avec %s à la place des mots cherchés, ou qui se termine par ?q=).
const SEARCH_ENGINES = ['duckduckgo', 'google', 'bing', 'brave', 'qwant', 'ecosia', 'none'];
const sanitizeSearchEngine = (v) => {
  const s = str(v, 500);
  return SEARCH_ENGINES.includes(s) ? s : s ? checkUrl(s) : 'duckduckgo';
};

// Style du statut des tuiles (#94) : pastille seule, pastille et temps de réponse, ou texte.
const STATUS_STYLES = ['dot', 'ms', 'text'];

function sanitizeDisplay(display) {
  const src = display && typeof display === 'object' ? display : {};
  return {
    ...Object.fromEntries(DISPLAY_OPTIONS.map((k) => [k, src[k] !== false])),
    statusStyle: STATUS_STYLES.includes(src.statusStyle) ? src.statusStyle : 'dot',
  };
}

// Mise en page : ordre et largeur (1 à 12 colonnes) des widgets et des catégories
// dans la grille. Seuls les éléments qui existent sont gardés ; ceux qui manquent
// sont placés par l'interface (largeur par défaut, à la fin).
const LAYOUT_KINDS = { widget: 'widgets', category: 'categories' };
const MAX_TABS = 20;

function sanitizeTabs(tabs) {
  const ids = new Set();
  return (Array.isArray(tabs) ? tabs : []).slice(0, MAX_TABS)
    .filter((t) => t && typeof t === 'object' && !Array.isArray(t))
    .map((t) => ({ id: uniqueId(ids, t.id, 'tab'), name: str(t.name, 50) || 'Onglet' }));
}

function sanitizeLayout(layout, cfg) {
  const seen = new Set();
  return (Array.isArray(layout) ? layout : []).slice(0, 1000).flatMap((it) => {
    const kind = it && LAYOUT_KINDS[it.kind] ? it.kind : null;
    const id = str(it?.id, 64);
    const key = `${kind}:${id}`;
    if (!kind || seen.has(key) || !cfg[LAYOUT_KINDS[kind]].some((x) => x.id === id)) return [];
    seen.add(key);
    const w = Math.round(Number(it.w));
    const out = { kind, id, w: Number.isFinite(w) ? Math.min(12, Math.max(1, w)) : 12 };
    // Hauteur fixe en pixels (#75), facultative : sans elle, la hauteur suit le contenu.
    const h = Math.round(Number(it.h));
    if (it.h != null && Number.isFinite(h)) out.h = Math.min(3000, Math.max(60, h));
    // Onglet de l'élément (#92) ; sans onglet (ou onglet supprimé) : affiché dans tous.
    if (cfg.tabs.some((t) => t.id === it.tab)) out.tab = it.tab;
    // Widget rangé dans une catégorie ; catégorie supprimée : il revient dans la grille.
    if (kind === 'widget' && cfg.categories.some((c) => c.id === it.category)) out.category = it.category;
    return [out];
  });
}

// Tuile liée à une VM / un LXC d'un widget Proxmox VE, ou à un conteneur Docker (#89) :
// sa charge s'affiche sur la tuile. Le lien réutilise la connexion existante, sans secret.
function sanitizeLink(l) {
  if (l?.type === 'proxmox') {
    const widget = str(l.widget, 64);
    const vmid = Number(l.vmid);
    return widget && Number.isInteger(vmid) && vmid > 0 && vmid < 1e9 ? { type: 'proxmox', widget, vmid } : undefined;
  }
  if (l?.type === 'docker') {
    const container = str(l.container, 128);
    return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container) ? { type: 'docker', container } : undefined;
  }
  return undefined;
}

// Ordre des cartes de stats : cpu, mem, up et disk:<chemin>.
function sanitizeStatsOrder(order) {
  const keys = (Array.isArray(order) ? order : []).map((k) => str(k, 520))
    .filter((k) => ['cpu', 'mem', 'up'].includes(k) || /^disk:./.test(k));
  return [...new Set(keys)].slice(0, 50);
}

function sanitizeConfig(input, previous) {
  if (!input || !Array.isArray(input.categories)) throw fail('bad_request', 'categories manquant');
  const catIds = new Set();
  const appIds = new Set(); // uniques sur tout le tableau : /api/status les range par identifiant
  const cfg = {
    revision: (previous?.revision || 0) + 1,
    title: str(input.title, 100) || 'Mon serveur',
    // Absent de la requête (ancienne interface) = inchangé.
    display: sanitizeDisplay(input.display ?? previous?.display),
    // Absente ou invalide (ancienne interface, script) : inchangée.
    tileSize: [input.tileSize, previous?.tileSize].find((s) => TILE_SIZES.includes(s)) || 'normal',
    searchEngine: sanitizeSearchEngine(input.searchEngine ?? previous?.searchEngine),
    widgets: sanitizeWidgets(input.widgets, previous?.widgets),
    notify: sanitizeNotify(input.notify, previous?.notify),
    disks: (Array.isArray(input.disks) ? input.disks : []).slice(0, 20)
      .map((d) => ({ path: str(d?.path, 500), label: str(d?.label, 50) }))
      .filter((d) => d.path),
    // Onglets (#92) : absents de la requête (ancienne interface) = inchangés.
    tabs: sanitizeTabs(input.tabs ?? previous?.tabs),
    categories: input.categories.map(item).map((c) => ({
      id: uniqueId(catIds, c.id, 'cat'),
      name: str(c.name, 100) || 'Sans nom',
      // Icône facultative (mêmes valeurs que les tuiles) ; repliée par défaut (#92).
      ...(str(c.icon, 2000) ? { icon: str(c.icon, 2000) } : {}),
      ...(c.collapsed === true ? { collapsed: true } : {}),
      apps: (Array.isArray(c.apps) ? c.apps : []).map(item).map((a) => {
        return {
          id: uniqueId(appIds, a.id, 'app'),
          name: str(a.name, 100) || 'App',
          url: checkUrl(str(a.url, 2000)),
          icon: str(a.icon, 2000),
          description: str(a.description, 200),
          link: sanitizeLink(a.link),
          check: sanitizeCheck(a.check),
        };
      }),
    })),
  };
  // Un lien vers un widget Proxmox supprimé (ou d'un autre type) disparaît avec lui.
  const pveWidgets = new Set(cfg.widgets.filter((w) => w.type === 'proxmox').map((w) => w.id));
  for (const a of cfg.categories.flatMap((c) => c.apps)) {
    if (a.link?.type === 'proxmox' && !pveWidgets.has(a.link.widget)) delete a.link;
  }
  // Absentes de la requête (ancienne interface) = inchangées.
  cfg.layout = sanitizeLayout(input.layout ?? previous?.layout, cfg);
  cfg.statsOrder = sanitizeStatsOrder(input.statsOrder ?? previous?.statsOrder);
  return cfg;
}

module.exports = { SECRET_FIELDS, sanitizeConfig, sanitizeNotify, publicConfig };
