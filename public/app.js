// Server Dashboard — interface web
// Les textes affichés passent par t() (voir i18n.js).
const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,     // config enregistrée
  draft: null,      // copie modifiée en mode édition
  status: {},       // { appId: { online, code, ms } }
  authed: false,
  loginRequired: false, // REQUIRE_LOGIN côté serveur
  editing: false,
  docker: null,
  search: '',       // texte de la recherche rapide (ignoré en mode édition)
  searchOpen: false, // champ ouvert avec « / » alors que la barre est masquée
};

// ---------- Utilitaires ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || t('common.error', { status: res.status })),
      { status: res.status, code: data.code, params: data.params });
  }
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 2800);
}

const BYTE_UNITS = t('unit.bytes').split(',');

const fmtBytes = (b) => {
  if (!b && b !== 0) return '–';
  let i = 0;
  while (b >= 1024 && i < BYTE_UNITS.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b >= 10 || i === 0 ? 0 : 1)} ${BYTE_UNITS[i]}`;
};

const fmtUptime = (s) => {
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} ${t('unit.day')} ${hh} h` : hh ? `${hh} h ${m} min` : `${m} min`;
};

const uid = (p) => `${p}-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`;

function iconUrl(icon) {
  if (!icon) return null;
  if (/^(https?:)?\/\//.test(icon) || icon.startsWith('/') || icon.startsWith('data:')) return icon;
  return `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${encodeURIComponent(icon.toLowerCase().trim())}.svg`;
}

function iconEl(app) {
  const box = h('div', { class: 'tile-icon' });
  const letter = (app.name || '?').trim().charAt(0).toUpperCase();
  const src = iconUrl(app.icon);
  if (!src) { box.textContent = letter; return box; }
  const img = h('img', { src, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => {
    // Repli : PNG du même dépôt, puis initiale.
    if (img.src.endsWith('.svg') && !/^(https?:)?\/\//.test(app.icon)) {
      img.src = img.src.replace('/svg/', '/png/').replace(/\.svg$/, '.png');
    } else {
      box.textContent = letter;
    }
  });
  box.append(img);
  return box;
}

// ---------- Rendu du tableau ----------
const current = () => (state.editing ? state.draft : state.config);

// Recherche sans tenir compte des majuscules ni des accents.
const fold = (s) => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const matchesSearch = (app, q) => fold(`${app.name} ${app.description || ''}`).includes(q);

function render() {
  const cfg = current();
  if (!cfg) return;
  document.title = cfg.title;
  $('#title').textContent = cfg.title;
  document.body.classList.toggle('editing', state.editing);
  $('#editBar').hidden = !state.editing;
  $('#editBtn').hidden = !state.authed || state.editing;
  $('#authBtn').textContent = state.authed ? t('btn.logout') : t('btn.login');
  const display = displayOptions(cfg);
  // Sans bouton de thème, le choix enregistré est ignoré : le CSS suit le système.
  if (display.theme && savedTheme()) document.documentElement.dataset.theme = savedTheme();
  else delete document.documentElement.dataset.theme;
  $('#themeBtn').hidden = !display.theme;
  $('#langBtn').hidden = !display.lang;
  const hasApps = cfg.categories.some((cat) => cat.apps.length);
  state.searchEnabled = !state.editing && hasApps;
  $('#search').hidden = !state.searchEnabled || !(display.search || state.searchOpen);
  const q = state.searchEnabled ? fold(state.search.trim()) : '';

  itemObserver.disconnect();
  const board = $('#board');
  board.replaceChildren();
  board.dataset.tiles = cfg.tileSize || 'normal'; // taille des tuiles : style.css

  $('#pwBanner').hidden = !(state.authed && state.defaultPassword);

  if (!cfg.categories.length && !cfg.widgets?.length && !state.editing) {
    boardMessage(welcomeCard());
  } else if (!cfg.categories.length) {
    boardMessage(h('div', { class: 'empty' }, state.editing ? t('empty.noCategoryEditing') : t('empty.noApps')));
  }

  // En édition, la mise en page complète (éléments manquants ajoutés) devient
  // celle du brouillon : déplacer ou redimensionner modifie directement ses objets.
  const layout = layoutOf(cfg);
  if (state.editing) cfg.layout = layout;
  let found = 0;
  layout.forEach((item, index) => {
    let el;
    if (item.kind === 'widget') {
      const wi = cfg.widgets.findIndex((w) => w.id === item.id);
      el = widgetCard(cfg.widgets[wi], wi);
    } else {
      const ci = cfg.categories.findIndex((c) => c.id === item.id);
      const result = categoryEl(cfg.categories[ci], ci, q);
      found += result.found;
      el = result.el;
    }
    if (el) board.append(boardItem(el, item, index));
  });
  if (q && !found) boardMessage(h('div', { class: 'empty' }, t('search.none', { query: state.search.trim() })));

  layoutBoard();
  for (const el of board.children) {
    fitRows(el);
    itemObserver.observe(el);
  }
  renderStatsOrder();
  updateSaveBar();
}

// Une catégorie de tuiles. Les index d'origine (ai) servent à l'édition, où la
// recherche est désactivée ; une catégorie dont le nom correspond s'affiche en entier.
function categoryEl(cat, ci, q) {
  const catMatch = !q || fold(cat.name).includes(q);
  const apps = cat.apps.map((app, ai) => ({ app, ai })).filter(({ app }) => catMatch || matchesSearch(app, q));
  if (!state.editing && !apps.length) return { el: null, found: 0 };
  const head = h('div', { class: 'category-head' }, h('h2', {}, cat.name));
  if (state.editing) {
    head.append(h('div', { class: 'category-tools' },
      h('button', { class: 'icon-btn', title: t('tool.rename'), onclick: () => renameCategory(ci) }, '✎'),
      h('button', { class: 'icon-btn danger', title: t('tool.delete'), onclick: () => deleteCategory(ci) }, '✕'),
    ));
  }

  // En édition, la grille accepte une tuile déposée hors des autres tuiles (à la fin).
  const grid = h('div', { class: 'grid', 'data-cat': ci, 'data-drop': state.editing ? 'tile' : null });
  apps.forEach(({ app, ai }) => grid.append(tileEl(app, ci, ai)));
  if (state.editing) grid.append(h('button', { class: 'add-tile', onclick: () => openAppDialog(ci) }, t('tile.add')));
  return { el: h('section', { class: 'category' }, head, grid), found: apps.length };
}

// ---------- Grille de mise en page ----------
// Widgets et catégories partagent une grille de 12 colonnes. `layout` donne leur
// ordre et leur largeur ; la hauteur suit le contenu, en lignes de 2 px, ce qui
// permet aux éléments de s'emboîter sans trou.
const GRID_COLS = 12;
const DEFAULT_WIDTH = { widget: 3, category: 12 };
const ROW_UNIT = 2;   // grid-auto-rows de .board (style.css)
const GRID_GAP = 14;  // espace entre éléments, horizontal (column-gap) et vertical

// Mise en page complète : celle de la config, puis les éléments qu'elle ne cite
// pas (config d'avant la grille, nouvel élément) avec leur largeur par défaut.
function layoutOf(cfg) {
  const lists = { widget: cfg.widgets || [], category: cfg.categories };
  const items = [];
  const seen = new Set();
  const add = (kind, id, w) => {
    const key = `${kind}:${id}`;
    if (!lists[kind] || seen.has(key) || !lists[kind].some((x) => x.id === id)) return;
    seen.add(key);
    items.push({ kind, id, w: Math.min(GRID_COLS, Math.max(1, Math.round(w) || DEFAULT_WIDTH[kind])) });
  };
  for (const it of cfg.layout || []) add(it.kind, it.id, it.w);
  for (const w of lists.widget) add('widget', w.id, DEFAULT_WIDTH.widget);
  for (const c of lists.category) add('category', c.id, DEFAULT_WIDTH.category);
  return items;
}

// Colonnes affichées selon la place : 12 sur grand écran, 6 sur tablette, 1 sur téléphone.
function boardCols() {
  const width = $('#board').clientWidth;
  return width >= 1000 ? GRID_COLS : width >= 600 ? 6 : 1;
}
const spanOf = (w, cols) => Math.max(1, Math.min(cols, Math.round((w * cols) / GRID_COLS)));

function layoutBoard() {
  const board = $('#board');
  const cols = boardCols();
  board.style.setProperty('--cols', cols);
  board.dataset.cols = cols;
  const items = [...board.querySelectorAll(':scope > .board-item')];
  for (const el of items) el.style.gridColumn = `span ${spanOf(Number(el.dataset.w), cols)}`;
  // Une largeur qui change change aussi la hauteur.
  items.forEach(fitRows);
}

// Chaque élément réserve autant de lignes que sa hauteur (plus l'espace en dessous).
// Calculé tout de suite au rendu, puis à chaque changement de taille (données d'un widget…).
function fitRows(el) {
  el.style.gridRowEnd = `span ${Math.ceil((el.getBoundingClientRect().height + GRID_GAP) / ROW_UNIT)}`;
}
const itemObserver = new ResizeObserver((entries) => entries.forEach((e) => fitRows(e.target)));

// Message sur toute la largeur (accueil, tableau vide, aucun résultat…).
function boardMessage(el) {
  el.classList.add('board-full');
  $('#board').append(el);
  fitRows(el);
  itemObserver.observe(el);
}

function boardItem(el, item, index) {
  el.classList.add('board-item');
  el.dataset.w = item.w;
  if (!state.editing) return el;

  el.dataset.index = index;
  el.append(h('div', {
    class: 'resize-handle', title: t('layout.resize'), 'aria-hidden': 'true',
    onpointerdown: (e) => startResize(e, el, item),
  }));
  // On tire l'en-tête : le reste d'une catégorie contient des tuiles, elles aussi déplaçables.
  makeDraggable(el, {
    handle: el.querySelector('.widget-head, .category-head'),
    group: 'item',
    key: `item:${item.kind}:${item.id}`,
    onDrop: (target, after) => moveItem(index, Number(target.dataset.index) + (after ? 1 : 0)),
    onStep: (delta) => moveItem(index, delta < 0 ? index - 1 : index + 2),
  });
  return el;
}

// Déplace l'élément `from` juste avant la position `to` (to = longueur : à la fin).
function moveItem(from, to) {
  const list = state.draft.layout;
  if (to < 0 || to > list.length) return;
  const [it] = list.splice(from, 1);
  if (from < to) to--;
  list.splice(to, 0, it);
  render();
}

// Poignée en bas à droite : la largeur suit le pointeur, colonne par colonne
// (souris, stylet ou doigt grâce aux Pointer Events).
function startResize(e, el, item) {
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget;
  handle.setPointerCapture?.(e.pointerId);
  const cols = boardCols();
  const colWidth = ($('#board').clientWidth + GRID_GAP) / cols;
  const left = el.getBoundingClientRect().left;
  el.classList.add('resizing');
  const move = (ev) => {
    const span = Math.max(1, Math.min(cols, Math.round((ev.clientX - left + GRID_GAP) / colWidth)));
    item.w = Math.max(1, Math.min(GRID_COLS, Math.round((span * GRID_COLS) / cols)));
    el.dataset.w = item.w;
    el.dataset.width = `${item.w} / ${GRID_COLS}`;
    el.style.gridColumn = `span ${span}`;
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    el.classList.remove('resizing');
    render();
  };
  move(e);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end, { once: true });
  handle.addEventListener('pointercancel', end, { once: true });
}

// Écran d'accueil d'un dashboard encore vide (première installation).
function welcomeCard() {
  const step = (done, text) => h('li', { class: done ? 'done' : '' }, text);
  return h('section', { class: 'welcome' },
    h('h2', {}, t('welcome.title')),
    h('p', { class: 'muted' }, t('welcome.intro')),
    h('ol', {},
      step(state.authed, state.authed ? t('welcome.step1Done') : t('welcome.step1')),
      step(false, t('welcome.step2')),
      step(false, t('welcome.step3'))),
    h('div', { class: 'welcome-actions' },
      state.authed
        ? h('button', { class: 'btn btn-primary', onclick: startEditing }, t('welcome.start'))
        : h('button', { class: 'btn btn-primary', onclick: onAuthClick }, t('welcome.login')),
      h('a', { class: 'btn btn-ghost', href: 'https://github.com/Circule-studio/server-dashboard#readme', target: '_blank', rel: 'noopener' }, t('welcome.docs'))));
}

function statusDot(app) {
  const s = state.status[app.id];
  if (!s) return h('span', { class: 'dot', title: t('status.checking') });
  if (!s.online) {
    const why = s.errorCode ? errMsg({ code: s.errorCode }) : s.error;
    return h('span', { class: 'dot bad', title: `${t('status.offline')}${why ? ' : ' + why : ''}` });
  }
  const slow = s.ms > 1500;
  return h('span', { class: `dot ${slow ? 'warn' : 'ok'}`, title: `${t('status.online')} · HTTP ${s.code} · ${s.ms} ms` });
}

function tileEl(app, ci, ai) {
  const text = h('div', { class: 'tile-text' },
    h('div', { class: 'tile-name' }, app.name),
    app.description ? h('div', { class: 'tile-desc' }, app.description) : null);

  if (!state.editing) {
    return h('a', { class: 'tile', href: app.url, target: '_blank', rel: 'noopener', title: app.url },
      iconEl(app), text, statusDot(app));
  }

  const tile = h('div', { class: 'tile', 'data-cat': ci, 'data-app': ai },
    iconEl(app), text,
    h('div', { class: 'tile-tools' },
      h('button', { class: 'icon-btn', title: t('tool.edit'), onclick: () => openAppDialog(ci, ai) }, '✎'),
      h('button', { class: 'icon-btn danger', title: t('tool.delete'), onclick: () => deleteApp(ci, ai) }, '✕')));

  makeDraggable(tile, {
    group: 'tile',
    key: `app:${app.id}`,
    // Déposée sur une tuile : avant ou après elle ; sur le fond d'une catégorie : à la fin.
    onDrop: (target, after) => {
      const toCat = Number(target.dataset.cat);
      const toIndex = target.classList.contains('grid')
        ? state.draft.categories[toCat].apps.length
        : Number(target.dataset.app) + (after ? 1 : 0);
      moveApp({ ci, ai }, toCat, toIndex);
    },
    onStep: (delta) => moveApp({ ci, ai }, ci, delta < 0 ? ai - 1 : ai + 2),
  });
  return tile;
}

// ---------- Widgets d'intégration ----------
// keyLabel, keyHelp, userLabel… sont des clés de traduction.
const WIDGET_TYPES = {
  pulse: {
    label: 'Pulse', icon: 'pulse', kind: 'pulse', refresh: 15_000, port: 7655,
    keyLabel: 'key.pulse', keyHelp: 'key.pulseHelp',
    sections: ['health', 'alerts', 'resources'],
  },
  proxmox: {
    label: 'Proxmox VE', icon: 'proxmox', kind: 'proxmox', refresh: 10_000, fields: ['url', 'username', 'apiKey'],
    scheme: 'https', port: 8006,
    userLabel: 'key.proxmoxUser', userHelp: 'key.proxmoxUserHelp', userRequired: true,
    keyLabel: 'key.proxmox', keyHelp: 'key.proxmoxHelp',
  },
  jellyfin: { label: 'Jellyfin', icon: 'jellyfin', kind: 'media', refresh: 10_000, keyHelp: 'key.jellyfinHelp', port: 8096 },
  plex: { label: 'Plex', icon: 'plex', kind: 'media', refresh: 10_000, keyLabel: 'key.plex', keyHelp: 'key.plexHelp', port: 32400 },
  qbittorrent: { label: 'qBittorrent', icon: 'qbittorrent', kind: 'torrent', refresh: 5_000, fields: ['url', 'username', 'password'], port: 8080 },
  sonarr: { label: 'Sonarr', icon: 'sonarr', kind: 'arr', refresh: 60_000, keyHelp: 'key.arrHelp', port: 8989 },
  radarr: { label: 'Radarr', icon: 'radarr', kind: 'arr', refresh: 60_000, keyHelp: 'key.arrHelp', port: 7878 },
  immich: { label: 'Immich', icon: 'immich', kind: 'immich', refresh: 5 * 60_000, keyHelp: 'key.immichHelp', port: 2283 },
  pihole: {
    label: 'Pi-hole', icon: 'pi-hole', kind: 'dns', refresh: 30_000, fields: ['url', 'password'],
    placeholder: 'http://192.168.1.10', passwordLabel: 'key.piholePassword', passwordHelp: 'key.piholePasswordHelp',
  },
  adguard: {
    label: 'AdGuard Home', icon: 'adguard-home', kind: 'dns', refresh: 30_000, fields: ['url', 'username', 'password'],
    placeholder: 'http://192.168.1.10', passwordHelp: 'key.adguardHelp',
  },
  // Sans URL, le serveur utilise le service public open-meteo.com.
  weather: {
    label: t('weather.label'), icon: '/icons/weather.svg', kind: 'weather', refresh: 10 * 60_000,
    fields: ['location', 'url'], nameFrom: 'location', urlOptional: true, urlLabel: 'weather.url', urlHelp: 'weather.urlHelp',
    scheme: 'https', placeholder: 'https://api.open-meteo.com', namePlaceholder: 'widget.namePlaceholderLocation',
  },
  // Sans URL, l'API publique de github.com ; le jeton est facultatif (dépôt public).
  github: {
    label: 'GitHub', icon: '/icons/github.svg', kind: 'github', refresh: 2 * 60_000,
    fields: ['repo', 'apiKey', 'url'], namePlaceholder: 'widget.namePlaceholderRepo', serverName: true,
    keyLabel: 'key.github', keyHelp: 'key.githubHelp', keyOptional: true,
    urlOptional: true, urlLabel: 'github.url', urlHelp: 'github.urlHelp', scheme: 'https', placeholder: 'https://api.github.com',
    sections: ['version', 'issues', 'pulls'],
    // Le titre mène à la page du dépôt : github.com, ou l'adresse de GitHub Enterprise sans /api/v3.
    href: (w) => {
      const web = !w.url || /^https:\/\/api\.github\.com\/?$/i.test(w.url) ? 'https://github.com' : w.url.replace(/\/api\/v3\/?$/, '');
      return w.repo ? `${web}/${w.repo}` : null;
    },
  },
};
const fieldsOf = (type) => WIDGET_TYPES[type].fields || ['url', 'apiKey'];

state.widgetData = {}; // { widgetId: { data } | { error } }
let widgetTimers = [];

const fmtSpeed = (b) => `${fmtBytes(b)}/s`;
const fmtEta = (s) => (s == null || s >= 8640000 ? '∞' : s < 60 ? `${s} s` : fmtUptime(s));
const pct = (p) => `${Math.round(Math.min(1, Math.max(0, p || 0)) * 100)} %`;
// Durée écoulée depuis une date : « 5 min », « 3 h », « 2 j ».
const fmtAgo = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  return s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} ${t('unit.day')}`;
};

function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 864e5);
  // Les dates Radarr sont à minuit UTC : l'heure n'a pas de sens.
  const time = d.getUTCHours() || d.getUTCMinutes()
    ? ' ' + d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : '';
  if (diff === 0) return `${t('day.today')}${time}`;
  if (diff === 1) return `${t('day.tomorrow')}${time}`;
  return d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }) + time;
}

// Codes météo WMO (doc Open-Meteo) -> icône ; le texte est dans weather.code.<code>.
const WEATHER_ICONS = [
  [[0], '☀️', '🌙'], [[1], '🌤️', '🌙'], [[2], '⛅', '☁️'], [[3], '☁️'], [[45, 48], '🌫️'],
  [[51, 53, 55, 56, 57, 80, 81, 82], '🌦️', '🌧️'], [[61, 63, 65, 66, 67], '🌧️'],
  [[71, 73, 75, 77, 85, 86], '🌨️'], [[95, 96, 97, 99], '⛈️'],
];
function weatherIcon(code, day = true) {
  const entry = WEATHER_ICONS.find(([codes]) => codes.includes(code));
  return entry ? (day ? entry[1] : entry[2] || entry[1]) : '🌡️';
}
const weatherText = (code) => (I18N[LANG][`weather.code.${code}`] ? t(`weather.code.${code}`) : '–');

function regionName(code) {
  try { return code ? new Intl.DisplayNames([LOCALE], { type: 'region' }).of(code) : ''; } catch { return code; }
}

function progressBar(p, cls = '') {
  return h('div', { class: 'bar bar-thin' }, h('i', { class: cls, style: `width:${Math.min(100, (p || 0) * 100)}%` }));
}

const RENDERERS = {
  media: (d) => [
    h('div', { class: 'widget-stats' }, d.stats.map((s) =>
      h('div', {}, h('b', {}, (s.value ?? 0).toLocaleString(LOCALE)), h('span', {}, t(`stat.${s.key}`))))),
    d.sessions.length
      ? h('ul', { class: 'widget-list' }, d.sessions.map((s) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: s.title }, `${s.paused ? '⏸' : '▶'} ${s.title}`),
          h('span', { class: 'muted' }, s.user || '')),
        h('div', { class: 'item-sub' }, [s.subtitle, s.device].filter(Boolean).join(' · ')),
        progressBar(s.progress, s.paused ? 'warn' : ''))))
      : h('p', { class: 'muted' }, t('media.nothing')),
  ],

  torrent: (d) => [
    h('div', { class: 'widget-stats' },
      h('div', {}, h('b', {}, fmtSpeed(d.download)), h('span', {}, t('torrent.down'))),
      h('div', {}, h('b', {}, fmtSpeed(d.upload)), h('span', {}, t('torrent.up'))),
      h('div', {}, h('b', {}, `${d.counts.downloading} / ${d.counts.seeding}`), h('span', {}, t('torrent.dlSeed')))),
    d.torrents.length
      ? h('ul', { class: 'widget-list' }, d.torrents.map((tor) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: tor.name }, tor.name),
          h('span', { class: 'muted' }, pct(tor.progress))),
        h('div', { class: 'item-sub' }, tor.group === 'downloading'
          ? `↓ ${fmtSpeed(tor.dlspeed)} · ${t('torrent.left', { eta: fmtEta(tor.eta) })}`
          : tor.group === 'seeding' ? `↑ ${fmtSpeed(tor.upspeed)} · ${fmtBytes(tor.size)}`
            : tor.group === 'error' ? t('torrent.error') : `${t('torrent.paused')} · ${fmtBytes(tor.size)}`),
        progressBar(tor.progress, tor.group === 'error' ? 'bad' : tor.group === 'paused' ? 'warn' : ''))))
      : h('p', { class: 'muted' }, t('torrent.none')),
  ],

  pulse: (d) => {
    const VERDICTS = [['ok', 'ok'], ['attention', 'warn'], ['critical', 'bad'], ['stale', 'warn'], ['off', '']];
    const verdictDot = (v) => (VERDICTS.find(([k]) => k === v) || [, ''])[1];
    const levelDot = { critical: 'bad', warning: 'warn', info: '' };
    const reason = (code) => (I18N[LANG][`pulse.reason.${code}`] ? t(`pulse.reason.${code}`) : code.replace(/[-_]/g, ' '));
    const typeLabel = (type) => (I18N[LANG][`pulse.type.${type}`] ? t(`pulse.type.${type}`) : type);
    const blocks = [];
    const many = d.sections.length > 1;

    if (d.health) {
      const { verdicts, counts, attention } = d.health;
      if (many) blocks.push(h('div', { class: 'widget-subhead' }, t('pulse.health')));
      blocks.push(h('div', { class: 'widget-stats pulse-verdicts' }, VERDICTS
        .filter(([k]) => k !== 'stale' || verdicts.stale)
        .map(([k, cls]) => h('div', { class: `verdict-${cls || 'off'}` },
          h('b', {}, String(verdicts[k] || 0)), h('span', {}, t(`pulse.verdict.${k}`))))));
      blocks.push(h('p', { class: 'pulse-counts muted' }, [
        tp('pulse.nodes', counts.nodes), t('pulse.vms', { count: counts.vms }), tp('pulse.containers', counts.containers),
        counts.docker ? tp('pulse.docker', counts.docker) : null,
      ].filter(Boolean).join(' · ')));
      if (attention.length) {
        blocks.push(h('ul', { class: 'widget-list' }, attention.map((a) => h('li', {},
          h('div', { class: 'row' },
            h('span', { class: 'item-title', title: typeLabel(a.type) }, h('span', { class: `dot ${verdictDot(a.verdict)}` }), ` ${a.name}`),
            h('span', { class: 'muted' }, reason(a.reason)))))));
      }
    }

    if (d.alerts) {
      if (many) blocks.push(h('div', { class: 'widget-subhead' }, t('pulse.alerts', { count: d.alerts.length })));
      blocks.push(d.alerts.length
        ? h('ul', { class: 'widget-list' }, d.alerts.map((a) => h('li', {},
          h('div', { class: 'row' },
            h('span', { class: 'item-title', title: a.text },
              h('span', { class: `dot ${levelDot[a.level] ?? ''}` }), ` ${a.resource}`),
            h('span', { class: 'muted' }, a.acknowledged ? t('pulse.acknowledged') : t('pulse.since', { duration: fmtAgo(a.since) }))),
          h('div', { class: 'item-sub' }, a.text))))
        : h('p', { class: 'muted' }, t('pulse.noAlerts')));
    }

    if (d.resources) {
      if (many) blocks.push(h('div', { class: 'widget-subhead' }, t('pulse.resources')));
      const fmt = (v) => (v == null ? '–' : `${Math.round(v)} %`);
      blocks.push(d.resources.length
        ? h('ul', { class: 'widget-list' }, d.resources.map((r) => {
          const dot = r.verdict ? verdictDot(r.verdict) : r.status === 'online' ? 'ok' : r.status === 'warning' ? 'warn' : '';
          return h('li', {},
            h('div', { class: 'row' },
              h('span', { class: 'item-title', title: r.parent ? `${r.name} (${r.parent})` : r.name },
                h('span', { class: `dot ${dot}` }), ' ', h('span', { class: 'badge' }, typeLabel(r.type)), ` ${r.name}`),
              h('span', { class: 'muted' }, r.status === 'offline' ? t('pulse.stopped') : `${fmt(r.cpu)} CPU · ${fmt(r.mem)} RAM`)));
        }))
        : h('p', { class: 'muted' }, t('pulse.noResources')));
    }
    return blocks;
  },

  proxmox: (d) => {
    const level = (r) => (r >= 0.9 ? 'bad' : r >= 0.7 ? 'warn' : 'ok');
    const meter = (label, ratio, detail) => h('div', { class: 'meter' },
      h('span', { class: 'meter-label' }, label),
      progressBar(ratio, level(ratio)),
      h('span', { class: 'meter-value' }, detail));
    const multiNode = d.nodes.length > 1;
    return [
      ...d.nodes.map((n) => h('div', { class: 'pve-node' },
        h('div', { class: 'row' },
          h('span', { class: 'item-title' }, h('span', { class: `dot ${n.online ? 'ok' : 'bad'}` }), ` ${n.name}`),
          h('span', { class: 'muted' }, n.online ? t('pve.onlineFor', { duration: fmtUptime(n.uptime) }) : t('pve.offline'))),
        n.online ? [
          meter('CPU', n.cpu, `${pct(n.cpu)} · ${t('pve.cores', { count: n.cores })}`),
          meter('RAM', n.mem / n.maxmem, `${fmtBytes(n.mem)} / ${fmtBytes(n.maxmem)}`),
          meter(t('pve.disk'), n.disk / n.maxdisk, `${fmtBytes(n.disk)} / ${fmtBytes(n.maxdisk)}`),
        ] : null)),
      h('div', { class: 'widget-subhead' }, t('pve.guests', { running: d.running, total: d.guests.length })),
      d.guests.length
        ? h('ul', { class: 'widget-list' }, d.guests.map((g) => h('li', {},
          h('div', { class: 'row' },
            h('span', { class: 'item-title', title: `${g.type} ${g.id} · ${g.name}` },
              h('span', { class: `dot ${g.running ? 'ok' : ''}` }), ' ',
              h('span', { class: 'badge' }, g.type), ` ${g.id} · ${g.name}`),
            h('span', { class: 'muted' }, g.running ? `${pct(g.cpu)} CPU · ${pct(g.mem)} RAM` : t('pve.stopped'))),
          multiNode ? h('div', { class: 'item-sub' }, g.node) : null)))
        : h('p', { class: 'muted' }, t('pve.noGuests')),
      d.storages.length ? h('div', { class: 'widget-subhead' }, t('pve.storages')) : null,
      ...d.storages.map((s) => meter(multiNode ? `${s.name} (${s.node})` : s.name, s.used / s.total,
        `${fmtBytes(s.used)} / ${fmtBytes(s.total)}`)),
    ];
  },

  arr: (d) => [
    h('div', { class: 'widget-subhead' }, t('arr.upcoming')),
    d.upcoming.length
      ? h('ul', { class: 'widget-list' }, d.upcoming.map((e) => {
        const title = e.title || t('arr.unknownSeries');
        const sub = e.subtitle ?? [e.year, e.release && t(`arr.release.${e.release}`)].filter(Boolean).join(' · ');
        return h('li', {},
          h('div', { class: 'row' },
            h('span', { class: 'item-title', title }, title),
            h('span', { class: e.hasFile ? 'badge ok' : 'muted' }, e.hasFile ? t('arr.available') : fmtDay(e.date))),
          h('div', { class: 'item-sub' }, sub));
      }))
      : h('p', { class: 'muted' }, t('arr.nothing')),
    h('div', { class: 'widget-subhead' }, t('arr.queue', { count: d.queue.total })),
    d.queue.items.length
      ? h('ul', { class: 'widget-list' }, d.queue.items.map((q) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: q.title }, q.title),
          h('span', { class: 'muted' }, pct(q.progress))),
        h('div', { class: 'item-sub' }, [q.status, q.timeleft && t('torrent.left', { eta: q.timeleft })].filter(Boolean).join(' · ')),
        progressBar(q.progress))))
      : h('p', { class: 'muted' }, t('arr.noDownloads')),
  ],

  immich: (d) => [
    h('div', { class: 'widget-stats' },
      h('div', {}, h('b', {}, (d.photos ?? 0).toLocaleString(LOCALE)), h('span', {}, t('stat.photos'))),
      h('div', {}, h('b', {}, (d.videos ?? 0).toLocaleString(LOCALE)), h('span', {}, t('stat.videos'))),
      h('div', {}, h('b', {}, fmtBytes(d.usage)), h('span', {}, t('stat.usage')))),
    // Le détail par utilisateur n'a d'intérêt qu'à partir de deux comptes.
    ...(d.users.length > 1 ? [
      h('div', { class: 'widget-subhead' }, t('immich.users')),
      h('ul', { class: 'widget-list' }, d.users.map((u) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: u.name }, u.name),
          h('span', { class: 'muted' }, u.quota ? `${fmtBytes(u.usage)} / ${fmtBytes(u.quota)}` : fmtBytes(u.usage))),
        h('div', { class: 'item-sub' }, t('immich.userLine', { photos: u.photos.toLocaleString(LOCALE), videos: u.videos.toLocaleString(LOCALE) })),
        u.quota ? progressBar(u.usage / u.quota, u.usage / u.quota >= 0.9 ? 'bad' : u.usage / u.quota >= 0.7 ? 'warn' : '') : null))),
    ] : []),
  ],

  dns: (d) => {
    const STATES = { enabled: 'ok', disabled: 'bad', failed: 'bad' };
    const protection = STATES[d.protection] ? d.protection : 'unknown';
    const extra = d.extra.filter((e) => e.value != null).map((e) => (e.key === 'avgTime'
      ? t('dns.avgTime', { ms: (e.value * 1000).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) })
      : tp(`dns.${e.key}`, e.value, { n: e.value.toLocaleString(LOCALE) })));
    return [
      h('div', { class: 'widget-stats' },
        h('div', {}, h('b', {}, d.queries.toLocaleString(LOCALE)), h('span', {}, t('dns.queries'))),
        h('div', {}, h('b', {}, d.blocked.toLocaleString(LOCALE)), h('span', {}, t('dns.blocked'))),
        h('div', {}, h('b', {}, `${d.percent.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} %`), h('span', {}, t('dns.percent')))),
      h('p', { class: 'dns-status' },
        h('span', { class: `dot ${STATES[protection] || ''}` }), ' ', t(`dns.${protection}`),
        // Pause temporaire : la protection revient d'elle-même.
        protection === 'disabled' && d.timer ? h('span', { class: 'muted' }, ` · ${t('dns.timer', { duration: fmtEta(Math.round(d.timer)) })}`) : null),
      extra.length ? h('p', { class: 'muted dns-extra' }, extra.join(' · ')) : null,
    ];
  },

  weather: (d) => {
    const c = d.current;
    const deg = (v) => (v == null ? '–' : `${Math.round(v)}°`);
    const place = d.place.name
      ? [d.place.name, regionName(d.place.country)].filter(Boolean).join(', ')
      : `${d.place.latitude}, ${d.place.longitude}`;
    const today = new Date().toLocaleDateString('sv'); // AAAA-MM-JJ, comme l'API
    return [
      h('div', { class: 'weather-now' },
        h('span', { class: 'weather-icon', role: 'img', 'aria-label': weatherText(c.code) }, weatherIcon(c.code, c.day)),
        h('div', { class: 'weather-main' },
          h('b', { class: 'weather-temp' }, c.temp == null ? '–' : `${Math.round(c.temp)} ${d.units.temp}`),
          h('div', {}, weatherText(c.code)),
          h('div', { class: 'item-sub' }, [
            c.feels != null ? t('weather.feels', { temp: deg(c.feels) }) : null,
            c.wind != null ? t('weather.wind', { speed: `${Math.round(c.wind)} ${d.units.wind}` }) : null,
          ].filter(Boolean).join(' · ')),
          h('div', { class: 'item-sub', title: place }, `📍 ${place}`))),
      h('div', { class: 'weather-days' }, d.days.map((day) => h('div', { title: weatherText(day.code) },
        h('span', { class: 'weather-day' }, day.date === today
          ? t('weather.today')
          : new Date(`${day.date}T12:00`).toLocaleDateString(LOCALE, { weekday: 'short' })),
        h('span', { class: 'weather-icon-sm', role: 'img', 'aria-label': weatherText(day.code) }, weatherIcon(day.code)),
        h('b', {}, deg(day.max)),
        h('span', { class: 'muted' }, deg(day.min)),
        day.rain ? h('small', { class: 'weather-rain', title: t('weather.rainChance') }, `💧 ${day.rain} %`) : null))),
    ];
  },

  github: (d) => {
    // En mode édition, un lien ne doit pas lancer le glisser natif du navigateur (comme le titre).
    const link = (url, text) => (url
      ? h('a', { href: url, target: '_blank', rel: 'noopener', draggable: state.editing ? 'false' : null }, text)
      : h('span', {}, text));
    const ago = (iso) => (iso ? t('github.ago', { duration: fmtAgo(iso) }) : '');
    const v = d.version;
    const blocks = [];
    // Limite de GitHub atteinte : les dernières données reçues restent affichées.
    if (d.limited) {
      blocks.push(h('p', { class: 'gh-limited' },
        `⏳ ${t('github.limited', { duration: fmtAgo(d.limited.since), minutes: d.limited.minutes })}`));
    }
    blocks.push(h('div', { class: 'widget-stats' },
      v ? h('div', { title: v.latest?.name || '' }, h('b', {}, v.latest?.tag || '–'), h('span', {}, t('github.version'))) : null,
      d.issues ? h('div', {}, h('b', {}, d.issues.total.toLocaleString(LOCALE)), h('span', {}, t('github.issues'))) : null,
      d.pulls ? h('div', {}, h('b', {}, d.pulls.total.toLocaleString(LOCALE)), h('span', {}, t('github.pulls'))) : null));
    blocks.push(h('p', { class: 'muted gh-meta' }, [
      d.repo.private ? t('github.private') : null,
      d.repo.archived ? t('github.archived') : null,
      `★ ${d.repo.stars.toLocaleString(LOCALE)}`,
      tp('github.forks', d.repo.forks, { n: d.repo.forks.toLocaleString(LOCALE) }),
      d.repo.pushed ? t('github.pushed', { duration: fmtAgo(d.repo.pushed) }) : null,
    ].filter(Boolean).join(' · ')));

    if (v) {
      blocks.push(h('div', { class: 'widget-subhead' }, t('github.versionHead')));
      const items = [];
      if (v.latest) {
        items.push(h('li', {},
          h('div', { class: 'row' },
            h('span', { class: 'item-title', title: v.latest.name }, '🏷 ', link(v.latest.url, v.latest.name),
              v.latest.prerelease ? h('span', { class: 'badge warn' }, t('github.prerelease')) : null),
            h('span', { class: 'muted' }, ago(v.latest.date))),
          h('div', { class: 'item-sub' }, v.unreleased == null ? ''
            : v.unreleased ? tp('github.unreleased', v.unreleased, { tag: v.latest.tag })
              : t('github.upToDate', { tag: v.latest.tag })),
          v.prerelease
            ? h('div', { class: 'item-sub' }, t('github.next', { tag: v.prerelease.tag, duration: fmtAgo(v.prerelease.date) }))
            : null,
          v.previous.length
            ? h('div', { class: 'item-sub' }, t('github.previous', { list: v.previous.map((r) => r.tag).join(' · ') }))
            : null));
      }
      if (v.commit) {
        items.push(h('li', {},
          h('div', { class: 'row' },
            h('span', { class: 'item-title', title: v.commit.message },
              h('code', { class: 'gh-sha' }, v.commit.sha), ' ', link(v.commit.url, v.commit.message)),
            h('span', { class: 'muted' }, ago(v.commit.date))),
          h('div', { class: 'item-sub' }, t('github.commitBy', { author: v.commit.author, branch: v.branch }))));
      }
      if (!v.latest && v.commit) items.unshift(h('li', { class: 'muted' }, t('github.noRelease')));
      blocks.push(items.length ? h('ul', { class: 'widget-list' }, items) : h('p', { class: 'muted' }, t('github.emptyRepo')));
    }

    // Issues et pull requests : même liste, avec un badge « brouillon » pour les PR.
    const list = (data, head, empty) => {
      blocks.push(h('div', { class: 'widget-subhead' }, t(head, { count: data.total.toLocaleString(LOCALE) })));
      blocks.push(data.items.length
        ? h('ul', { class: 'widget-list' }, data.items.map((i) => h('li', {},
          h('div', { class: 'row' },
            h('span', { class: 'item-title', title: i.title },
              i.draft ? h('span', { class: 'badge' }, t('github.draft')) : null, link(i.url, i.title)),
            h('span', { class: 'muted' }, ago(i.date))),
          h('div', { class: 'item-sub' },
            t('github.by', { number: i.number, author: i.author }),
            ...i.labels.map((l) => h('span', { class: 'gh-label' },
              h('i', { style: l.color ? `background:#${l.color}` : null }), l.name))))))
        : h('p', { class: 'muted' }, t(empty)));
    };
    if (d.issues) list(d.issues, 'github.issuesHead', 'github.noIssues');
    if (d.pulls) list(d.pulls, 'github.pullsHead', 'github.noPulls');
    return blocks;
  },
};

function widgetCard(w, i) {
  const type = WIDGET_TYPES[w.type];
  // Sans URL (ex. météo sur le service public), le titre n'est pas un lien.
  const href = type.href ? type.href(w) : w.url;
  const head = h('div', { class: 'widget-head' },
    iconEl({ name: w.name, icon: type.icon }),
    href
      ? h('a', { class: 'widget-title', href, target: '_blank', rel: 'noopener', draggable: state.editing ? 'false' : null }, w.name || type.label)
      : h('span', { class: 'widget-title' }, w.name || type.label));
  const card = h('article', { class: `widget widget-${type.kind}`, 'data-widget': w.id }, head, widgetBody(w));
  if (!state.editing) return card;

  head.append(h('div', { class: 'tile-tools' },
    h('button', { class: 'icon-btn', title: t('tool.edit'), onclick: () => openWidgetDialog(i) }, '✎'),
    h('button', { class: 'icon-btn danger', title: t('tool.delete'), onclick: () => deleteWidget(i) }, '✕')));
  return card;
}

function widgetBody(w) {
  const entry = state.widgetData[w.id];
  const saved = state.config.widgets.some((x) => x.id === w.id);
  let content;
  if (!saved) content = h('p', { class: 'muted' }, t('widget.saveToLoad'));
  else if (!entry) content = h('p', { class: 'muted' }, t('common.loading'));
  else if (entry.error) content = h('p', { class: 'error' }, `⚠ ${entry.error}`);
  else content = RENDERERS[WIDGET_TYPES[w.type].kind](entry.data);
  return h('div', { class: 'widget-body' }, content);
}

function updateWidget(id) {
  const card = document.querySelector(`[data-widget="${CSS.escape(id)}"]`);
  const w = current().widgets.find((x) => x.id === id);
  if (card && w) card.querySelector('.widget-body').replaceWith(widgetBody(w));
}

// Après une erreur, on réessaie sans attendre l'intervalle normal (10 min pour la météo) :
// 30 s, puis 1 min, 2 min… sans dépasser cet intervalle. Un succès remet le compteur à zéro.
const RETRY_MS = 30_000;
const retries = {}; // id du widget -> { timer, attempt }

async function refreshWidget(id) {
  clearTimeout(retries[id]?.timer);
  try {
    state.widgetData[id] = { data: await api(`/api/widgets/${encodeURIComponent(id)}`) };
    delete retries[id];
  } catch (e) {
    state.widgetData[id] = { error: errMsg(e) };
    const w = state.config.widgets.find((x) => x.id === id);
    const every = w && WIDGET_TYPES[w.type]?.refresh;
    if (every > RETRY_MS) {
      const attempt = retries[id]?.attempt ?? 0;
      const delay = Math.min(RETRY_MS * 2 ** attempt, every);
      if (delay < every) retries[id] = { attempt: attempt + 1, timer: setTimeout(() => refreshWidget(id), delay) };
    }
  }
  updateWidget(id);
}

function scheduleWidgets() {
  widgetTimers.forEach(clearInterval);
  widgetTimers = [];
  for (const r of Object.values(retries)) clearTimeout(r.timer);
  for (const id of Object.keys(retries)) delete retries[id];
  state.widgetData = {};
  for (const w of state.config.widgets) {
    refreshWidget(w.id);
    widgetTimers.push(setInterval(() => refreshWidget(w.id), WIDGET_TYPES[w.type].refresh));
  }
}

function deleteWidget(i) {
  const w = state.draft.widgets[i];
  if (!confirm(t('widget.deleteConfirm', { name: w.name }))) return;
  state.draft.widgets.splice(i, 1);
  render();
}

let widgetDialogIndex = null;

function openWidgetDialog(i) {
  widgetDialogIndex = i ?? null;
  const w = i != null ? state.draft.widgets[i] : { type: 'jellyfin' };
  const f = $('#widgetForm').elements;
  $('#widgetDialogTitle').textContent = i != null ? t('widget.edit') : t('widget.new');
  f.type.replaceChildren(...Object.entries(WIDGET_TYPES).map(([k, type]) =>
    h('option', { value: k, selected: k === w.type }, type.label)));
  f.type.disabled = i != null; // changer de type mélangerait les identifiants
  f.name.value = w.name || '';
  f.location.value = w.location || '';
  f.repo.value = w.repo || '';
  f.url.value = w.url || '';
  f.username.value = w.username || '';
  f.apiKey.value = '';
  f.password.value = '';
  f.clearApiKey.checked = false;
  f.clearPassword.checked = false;
  f.apiKey.placeholder = w.hasApiKey ? t('widget.keyUnchanged') : '';
  f.password.placeholder = w.hasPassword ? t('widget.passwordUnchanged') : '';
  updateWidgetFields();
  $('#widgetDialog').showModal();
}

function updateWidgetFields() {
  const form = $('#widgetForm');
  const typeId = form.elements.type.value;
  const type = WIDGET_TYPES[typeId];
  const fields = fieldsOf(typeId);
  const w = widgetDialogIndex != null ? state.draft.widgets[widgetDialogIndex] : {};
  form.querySelectorAll('[data-field]').forEach((label) => {
    const on = fields.includes(label.dataset.field);
    label.hidden = !on;
    label.querySelector('input, textarea').disabled = !on;
  });
  // Secret déjà enregistré : un champ vide veut dire « inchangé », d'où une case pour l'effacer.
  for (const field of ['apiKey', 'password']) {
    const saved = w.type === typeId && w[`has${field[0].toUpperCase()}${field.slice(1)}`];
    const box = form.querySelector(`[data-clear="${field}"]`);
    box.hidden = !(fields.includes(field) && saved);
    if (box.hidden) box.querySelector('input').checked = false;
  }
  form.querySelector('[data-url-label]').textContent = t(type.urlLabel || 'widget.url');
  form.querySelector('[data-url-help]').textContent = t(type.urlHelp || 'widget.urlHelp');
  form.querySelector('[data-password-label]').textContent = t(type.passwordLabel || 'widget.password');
  form.querySelector('[data-password-help]').textContent = type.passwordHelp ? t(type.passwordHelp) : '';
  form.elements.url.required = !type.urlOptional;
  form.elements.name.placeholder = t(type.namePlaceholder || 'widget.namePlaceholder');
  form.elements.location.required = fields.includes('location');
  form.elements.repo.required = fields.includes('repo');
  form.querySelector('[data-key-label]').textContent = t(type.keyLabel || 'key.apiKey');
  form.querySelector('[data-key-help]').textContent = type.keyHelp ? t(type.keyHelp) : '';
  form.elements.apiKey.required = fields.includes('apiKey') && !type.keyOptional && !w.hasApiKey;
  form.elements.username.required = !!type.userRequired;
  form.querySelector('[data-user-label]').textContent = t(type.userLabel || 'widget.username');
  form.elements.username.placeholder = type.userHelp ? t(type.userHelp) : '';
  form.elements.url.placeholder = type.placeholder || `${type.scheme || 'http'}://192.168.1.10:${type.port}`;

  syncClearBoxes();

  // Blocs au choix (ex. Pulse) : une case par bloc, toutes cochées par défaut.
  const box = form.querySelector('[data-sections]');
  box.hidden = !type.sections;
  const chosen = w.type === typeId && w.sections?.length ? w.sections : (type.sections || []);
  form.querySelector('[data-sections-list]').replaceChildren(...(type.sections || []).map((s) =>
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'section', value: s, checked: chosen.includes(s) }),
      t(`${typeId}.sec.${s}`))));
}

// Case « Effacer » cochée : le champ du secret est vidé et désactivé.
function syncClearBoxes() {
  const f = $('#widgetForm').elements;
  const unchanged = { apiKey: 'widget.keyUnchanged', password: 'widget.passwordUnchanged' };
  for (const [box, input] of [[f.clearApiKey, f.apiKey], [f.clearPassword, f.password]]) {
    if (input.closest('[data-field]').hidden) continue;
    input.disabled = box.checked;
    if (box.checked) input.value = '';
    // « inchangé » n'a plus de sens quand le secret va être effacé.
    if (!box.closest('[data-clear]').hidden) input.placeholder = box.checked ? '' : t(unchanged[input.name]);
  }
}

function submitWidget(e) {
  e.preventDefault();
  const f = e.target.elements;
  const typeId = f.type.value;
  const fields = fieldsOf(typeId);
  const prev = widgetDialogIndex != null ? state.draft.widgets[widgetDialogIndex] : null;
  const type = WIDGET_TYPES[typeId];
  // Nom par défaut : le lieu pour la météo (« Nantes »), le dépôt normalisé par le serveur pour
  // GitHub (serverName), sinon le type.
  const w = {
    id: prev?.id || uid('wid'),
    type: typeId,
    name: f.name.value.trim() || (type.nameFrom && f[type.nameFrom].value.trim()) || (type.serverName ? '' : type.label),
    url: f.url.value.trim(),
    hasApiKey: prev?.hasApiKey,
    hasPassword: prev?.hasPassword,
  };
  if (fields.includes('location')) w.location = f.location.value.trim();
  if (fields.includes('repo')) w.repo = f.repo.value.trim(); // normalisé par le serveur
  if (fields.includes('apiKey')) {
    if (f.clearApiKey.checked) Object.assign(w, { clearApiKey: true, hasApiKey: false });
    else w.apiKey = f.apiKey.value.trim();
  }
  if (fields.includes('username')) w.username = f.username.value.trim();
  if (fields.includes('password')) {
    if (f.clearPassword.checked) Object.assign(w, { clearPassword: true, hasPassword: false });
    else w.password = f.password.value;
  }
  if (type.sections) {
    w.sections = [...e.target.querySelectorAll('input[name=section]:checked')].map((c) => c.value);
    if (!w.sections.length) {
      toast(t('widget.sectionsRequired'), true);
      return;
    }
    // Un seul bloc sans nom choisi : « Pulse · Alertes » plutôt que « Pulse ».
    if (!f.name.value.trim() && !type.serverName && w.sections.length === 1) {
      w.name = `${type.label} · ${t(`${typeId}.sec.${w.sections[0]}.short`)}`;
    }
  }
  if (prev) state.draft.widgets[widgetDialogIndex] = w;
  else state.draft.widgets.push(w);
  $('#widgetDialog').close();
  render();
}

// ---------- Glisser-déposer (souris, stylet et doigt) ----------
// Pointer Events plutôt que le glisser-déposer HTML5, qui ne marche pas au doigt.
// Chaque élément déplaçable a un groupe (tile, item, stat) et ne se dépose que sur
// un élément marqué data-drop du même groupe. Au clavier : flèches sur l'élément
// sélectionné (Tab), pour le reculer ou l'avancer d'un cran.
const DRAG_THRESHOLD = 6; // px parcourus avant qu'un appui devienne un glisser
const EDGE_SCROLL = 60;   // px du bord de la fenêtre où la page défile toute seule
let drag = null;          // glisser en cours

function makeDraggable(el, { handle = el, group, key, onDrop, onStep, enabled = () => state.editing }) {
  el.dataset.drop = group;
  el.dataset.dragKey = key;
  handle.classList.add('drag-handle');
  if (enabled()) {
    handle.title = t('drag.handle');
    el.tabIndex = 0;
  }
  el.addEventListener('keydown', (e) => {
    if (!enabled() || e.target !== el || e.ctrlKey || e.metaKey || e.altKey) return;
    const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    onStep(delta);
    document.querySelector(`[data-drag-key="${CSS.escape(key)}"]`)?.focus();
  });
  handle.addEventListener('pointerdown', (e) => {
    if (!enabled() || drag || e.button !== 0) return;
    if (e.target.closest('button, input, select, textarea, .resize-handle')) return;
    const start = { x: e.clientX, y: e.clientY };
    let started = false;
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
        started = true;
        beginDrag(el, group, ev);
      }
      ev.preventDefault();
      updateDrag(ev);
    };
    const stop = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      if (started) endDrag(ev.type === 'pointerup' ? onDrop : null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  });
}

function beginDrag(el, group, ev) {
  const r = el.getBoundingClientRect();
  // Copie qui suit le pointeur ; l'original reste en place, estompé.
  const ghost = el.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.classList.add('drag-ghost');
  ghost.style.width = `${r.width}px`;
  document.body.append(ghost);
  el.classList.add('dragging');
  document.body.classList.add('is-dragging');
  drag = { el, group, ghost, dx: ev.clientX - r.left, dy: ev.clientY - r.top, target: null, after: false, y: ev.clientY };
  drag.scroller = setInterval(() => {
    if (drag.y < EDGE_SCROLL) scrollBy(0, -14);
    else if (drag.y > innerHeight - EDGE_SCROLL) scrollBy(0, 14);
  }, 16);
}

function updateDrag(ev) {
  drag.y = ev.clientY;
  drag.ghost.style.transform = `translate(${ev.clientX - drag.dx}px, ${ev.clientY - drag.dy}px)`;
  const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(`[data-drop="${drag.group}"]`);
  const target = hit && hit !== drag.el && !drag.el.contains(hit) ? hit : null;
  if (drag.target && drag.target !== target) drag.target.classList.remove('drop-before', 'drop-after', 'drop-into');
  drag.target = target;
  if (!target) return;
  if (target.classList.contains('grid')) {
    target.classList.add('drop-into');
    return;
  }
  drag.after = dropAfter(ev, target);
  target.classList.toggle('drop-before', !drag.after);
  target.classList.toggle('drop-after', drag.after);
}

function endDrag(onDrop) {
  const { el, ghost, target, after, scroller } = drag;
  clearInterval(scroller);
  ghost.remove();
  el.classList.remove('dragging');
  target?.classList.remove('drop-before', 'drop-after', 'drop-into');
  document.body.classList.remove('is-dragging');
  drag = null;
  // Le relâchement ne doit pas aussi « cliquer » (lien du titre d'un widget…).
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  if (onDrop && target) onDrop(target, after);
}

// Déposé sur la seconde moitié : après l'élément. Un élément qui occupe presque
// toute la largeur de son conteneur se coupe en haut / bas, les autres en gauche / droite.
function dropAfter(e, el) {
  const r = el.getBoundingClientRect();
  const fullRow = r.width > el.parentElement.clientWidth * 0.75;
  el.dataset.axis = fullRow ? 'y' : 'x';
  return fullRow ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
}

function moveApp(from, toCat, toIndex) {
  const cats = state.draft.categories;
  if (toIndex < 0 || toIndex > cats[toCat].apps.length) return;
  const [app] = cats[from.ci].apps.splice(from.ai, 1);
  // Si on déplace vers la droite dans la même catégorie, l'index cible a reculé d'un cran.
  if (from.ci === toCat && from.ai < toIndex) toIndex--;
  cats[toCat].apps.splice(toIndex, 0, app);
  render();
}

// ---------- Ordre des cartes de stats ----------
// Clés : cpu, mem, up et disk:<chemin>. Une carte absente de statsOrder (nouveau
// disque) garde sa place par défaut, après celles dont l'ordre est enregistré.
function renderStatsOrder() {
  const cfg = current();
  if (!cfg) return;
  const order = cfg.statsOrder || [];
  [...$('#stats').children].forEach((card, i) => {
    const pos = order.indexOf(card.dataset.stat);
    card.style.order = pos >= 0 ? pos : order.length + i;
    // Les cartes existent hors édition : sélection au clavier et aide seulement en édition.
    card.tabIndex = state.editing ? 0 : -1;
    card.title = state.editing ? t('drag.handle') : '';
  });
}

function statsInOrder() {
  return [...$('#stats').children].sort((a, b) => a.style.order - b.style.order).map((c) => c.dataset.stat);
}

function makeStatDraggable(card) {
  const move = (to) => {
    const keys = statsInOrder();
    const from = keys.indexOf(card.dataset.stat);
    if (to < 0 || to > keys.length) return;
    keys.splice(from, 1);
    keys.splice(from < to ? to - 1 : to, 0, card.dataset.stat);
    state.draft.statsOrder = keys;
    renderStatsOrder();
    updateSaveBar();
  };
  makeDraggable(card, {
    group: 'stat',
    key: `stat:${card.dataset.stat}`,
    onDrop: (target, after) => move(statsInOrder().indexOf(target.dataset.stat) + (after ? 1 : 0)),
    onStep: (delta) => {
      const i = statsInOrder().indexOf(card.dataset.stat);
      move(delta < 0 ? i - 1 : i + 2);
    },
  });
}

// ---------- Actions d'édition ----------
async function renameCategory(ci) {
  const name = await askText(t('category.rename'), t('common.name'), state.draft.categories[ci].name);
  if (name) { state.draft.categories[ci].name = name; render(); }
}

function deleteCategory(ci) {
  const cat = state.draft.categories[ci];
  if (cat.apps.length && !confirm(t('category.deleteConfirm', { name: cat.name, count: cat.apps.length }))) return;
  state.draft.categories.splice(ci, 1);
  render();
}

function deleteApp(ci, ai) {
  const app = state.draft.categories[ci].apps[ai];
  if (!confirm(t('app.deleteConfirm', { name: app.name }))) return;
  state.draft.categories[ci].apps.splice(ai, 1);
  render();
}

async function startEditing() {
  // Config fraîche et complète (noms d'utilisateur inclus, réservés aux admins
  // connectés) : on n'édite jamais une copie chargée avant la connexion.
  try {
    state.config = await api('/api/config');
  } catch (e) {
    return toast(errMsg(e), true);
  }
  state.draft = structuredClone(state.config);
  state.editing = true;
  render();
  // Après le premier rendu, qui complète la mise en page du brouillon : c'est
  // l'état « sans modification » auquel on compare pour afficher la popup.
  state.cleanDraft = JSON.stringify(state.draft);
  updateSaveBar();
}

function stopEditing() {
  state.editing = false;
  state.draft = null;
  state.cleanDraft = null;
  render();
}

// ---------- Modifications non enregistrées ----------
const isDirty = () => state.editing && JSON.stringify(state.draft) !== state.cleanDraft;

function updateSaveBar() {
  $('#saveBar').hidden = !isDirty();
}

// Abandonner les modifications : confirmation s'il y en a.
const confirmDiscard = () => !isDirty() || confirm(t('save.leaveConfirm'));

// Popup « Annuler » : on revient à l'état du début de l'édition, sans quitter le mode édition.
function discardChanges() {
  state.draft = JSON.parse(state.cleanDraft);
  render();
  renderStatsOrder();
}

async function save() {
  const btn = $('#saveBtn');
  btn.disabled = true;
  try {
    state.config = await api('/api/config', { method: 'PUT', body: state.draft });
    stopEditing();
    toast(t('save.done'));
    refreshSystem();
    refreshStatus();
    scheduleWidgets();
  } catch (e) {
    if (e.code === 'conflict') {
      // Quelqu'un a enregistré ailleurs : on n'écrase pas son travail.
      if (confirm(`${errMsg(e)}\n\n${t('save.conflictReload')}`)) {
        stopEditing();
        state.config = await api('/api/config');
        render();
        scheduleWidgets();
        toast(t('save.reloaded'));
      }
      return;
    }
    toast(errMsg(e), true);
    if (e.status === 401) { state.authed = false; render(); }
  } finally {
    btn.disabled = false;
  }
}

// ---------- Dialogues ----------
function bindCloseButtons(dialog) {
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close('cancel')));
}

function askText(title, label, value = '') {
  const dlg = $('#textDialog');
  const form = $('#textForm');
  $('#textDialogTitle').textContent = title;
  $('#textDialogLabel').textContent = label;
  form.elements.value.value = value;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok' ? form.elements.value.value.trim() : null);
    }, { once: true });
  });
}

let appDialogTarget = null; // { ci, ai? }

function openAppDialog(ci, ai) {
  appDialogTarget = { ci, ai };
  const app = ai != null ? state.draft.categories[ci].apps[ai] : {};
  const form = $('#appForm');
  $('#appDialogTitle').textContent = ai != null ? t('app.edit') : t('app.new');
  form.elements.name.value = app.name || '';
  form.elements.url.value = app.url || '';
  form.elements.icon.value = app.icon || '';
  form.elements.description.value = app.description || '';
  form.elements.category.replaceChildren(...state.draft.categories.map((c, i) =>
    h('option', { value: i, selected: i === ci }, c.name)));
  $('#appDialog').showModal();
}

function submitApp(e) {
  e.preventDefault();
  const form = e.target;
  const { ci, ai } = appDialogTarget;
  const cats = state.draft.categories;
  const app = {
    id: ai != null ? cats[ci].apps[ai].id : uid('app'),
    name: form.elements.name.value.trim(),
    url: form.elements.url.value.trim(),
    icon: form.elements.icon.value.trim(),
    description: form.elements.description.value.trim(),
  };
  const targetCat = Number(form.elements.category.value);
  if (ai != null) {
    if (targetCat === ci) cats[ci].apps[ai] = app;
    else { cats[ci].apps.splice(ai, 1); cats[targetCat].apps.push(app); }
  } else {
    cats[targetCat].apps.push(app);
  }
  $('#appDialog').close();
  render();
}

async function onAuthClick() {
  if (state.authed) {
    if (!confirmDiscard()) return;
    await api('/api/logout', { method: 'POST' });
    if (state.loginRequired) return location.reload();
    state.authed = false;
    stopEditing();
    renderDocker();
    toast(t('login.loggedOut'));
    return;
  }
  $('#loginError').textContent = '';
  $('#loginForm').reset();
  $('#loginDialog').showModal();
}

async function submitLogin(e) {
  e.preventDefault();
  try {
    await api('/api/login', { method: 'POST', body: { password: e.target.password.value } });
    // Écran de connexion obligatoire : rien n'est encore chargé, on recharge tout.
    if (state.loginRequired && !state.config) return location.reload();
    state.authed = true;
    state.config = await api('/api/config'); // inclut maintenant les champs réservés aux admins
    state.defaultPassword = (await api('/api/me')).defaultPassword;
    $('#loginDialog').close();
    render();
    renderDocker();
    toast(t('login.loggedIn'));
  } catch (err) {
    $('#loginError').textContent = errMsg(err);
  }
}

// ---------- Stats système ----------
function setStat(id, value, sub, percent = 0) {
  const el = $(id);
  el.querySelector('b').textContent = value;
  el.querySelector('small').textContent = sub;
  const bar = el.querySelector('.bar i');
  if (bar) {
    bar.style.width = `${Math.min(100, percent)}%`;
    bar.className = percent >= 90 ? 'bad' : percent >= 70 ? 'warn' : '';
  }
}

async function refreshSystem() {
  try {
    const s = await api('/api/system');
    $('#host').textContent = s.hostname;
    setStat('#stat-cpu', `${s.cpu.usage.toFixed(0)} %`,
      t('stat.cpuSub', { cores: s.cpu.cores, load: s.cpu.load.map((l) => l.toFixed(2)).join(' ') }), s.cpu.usage);
    const memPct = (s.memory.used / s.memory.total) * 100;
    setStat('#stat-mem', `${memPct.toFixed(0)} %`, `${fmtBytes(s.memory.used)} / ${fmtBytes(s.memory.total)}`, memPct);
    state.system = s;
    renderDisks(s.disks || [s.disk]);
    setStat('#stat-up', fmtUptime(s.uptime), s.platform);
  } catch { /* le serveur est peut-être en train de redémarrer */ }
}

// Une carte par disque, insérées avant la carte Uptime.
function renderDisks(disks) {
  const stats = $('#stats');
  stats.querySelectorAll('.stat-disk').forEach((el) => el.remove());
  for (const d of disks) {
    const percent = d.total ? (d.used / d.total) * 100 : 0;
    const name = d.label || (disks.length > 1 ? d.path : t('stat.disk'));
    const error = d.errorCode ? errMsg({ code: d.errorCode }) : d.error;
    const card = h('div', { class: 'stat stat-disk', 'data-stat': `disk:${d.path}` },
      h('div', { class: 'stat-head' }, h('span', { title: d.path }, name), h('b', {}, error ? '–' : `${percent.toFixed(0)} %`)),
      h('div', { class: 'bar' }, h('i', { class: percent >= 90 ? 'bad' : percent >= 70 ? 'warn' : '', style: `width:${Math.min(100, percent)}%` })),
      h('small', { class: 'muted', title: d.path },
        error ? `${error} · ${d.path}` : `${fmtBytes(d.used)} / ${fmtBytes(d.total)} · ${d.path}`));
    makeStatDraggable(card);
    stats.insertBefore(card, $('#stat-up'));
  }
  renderStatsOrder();
}

// ---------- Choix des disques (mode édition) ----------
async function openDisksDialog() {
  const list = $('#disksList');
  list.replaceChildren(h('p', { class: 'muted' }, t('disks.searching')));
  $('#disksForm').reset();
  $('#disksDialog').showModal();
  let detected = [];
  try {
    detected = await api('/api/disks');
  } catch (e) {
    list.replaceChildren(h('p', { class: 'error' }, errMsg(e)));
    return;
  }
  // Disques déjà affichés : ceux de la config, sinon le disque par défaut renvoyé par /api/system.
  const chosen = state.draft.disks?.length ? state.draft.disks : (state.system?.disks || []).map((d) => ({ path: d.path, label: '' }));
  const rows = [...chosen.map((c) => ({ ...detected.find((d) => d.path === c.path), ...c, checked: true }))];
  for (const d of detected) if (!rows.some((r) => r.path === d.path)) rows.push({ ...d, label: '', checked: false });
  if (!rows.length) {
    list.replaceChildren(h('p', { class: 'muted' }, t('disks.none')));
    return;
  }
  list.replaceChildren(...rows.map((r) => h('label', { class: 'disk-row', 'data-path': r.path },
    h('input', { type: 'checkbox', checked: r.checked }),
    h('span', { class: 'disk-info' },
      h('b', {}, r.path),
      h('small', { class: 'muted' }, r.total ? `${fmtBytes(r.used)} / ${fmtBytes(r.total)}${r.type ? ' · ' + r.type : ''}` : t('disks.notDetected'))),
    h('input', { class: 'disk-label', placeholder: t('disks.labelPlaceholder'), maxlength: 50, value: r.label || '' }))));
}

function submitDisks(e) {
  e.preventDefault();
  const disks = [...$('#disksList').querySelectorAll('.disk-row')]
    .filter((row) => row.querySelector('input[type=checkbox]').checked)
    .map((row) => ({ path: row.dataset.path, label: row.querySelector('.disk-label').value.trim() }));
  const extra = e.target.elements.extra.value.trim();
  if (extra && !disks.some((d) => d.path === extra)) disks.push({ path: extra, label: '' });
  state.draft.disks = disks;
  $('#disksDialog').close();
  updateSaveBar();
  toast(disks.length ? t('disks.selected', { count: disks.length }) : t('disks.defaultRestored'));
}

// ---------- Options d'affichage (mode édition) ----------
function openDisplayDialog() {
  const form = $('#displayForm');
  const display = displayOptions(state.draft);
  for (const key of Object.keys(display)) form.elements[key].checked = display[key];
  form.elements.tileSize.value = state.draft.tileSize || 'normal';
  $('#displayDialog').showModal();
}

function submitDisplay(e) {
  e.preventDefault();
  const form = e.target;
  state.draft.display = Object.fromEntries(['search', 'theme', 'lang'].map((k) => [k, form.elements[k].checked]));
  state.draft.tileSize = form.elements.tileSize.value;
  $('#displayDialog').close();
  render();
}

// ---------- Statut des services ----------
async function refreshStatus() {
  try {
    state.status = await api('/api/status');
    if (!state.editing) render();
  } catch { /* ignoré */ }
}

// ---------- Docker ----------
async function refreshDocker() {
  try {
    state.docker = await api('/api/docker/containers');
  } catch (e) {
    state.docker = { available: false, error: e.message };
  }
  renderDocker();
}

function renderDocker() {
  const d = state.docker;
  const body = $('#dockerBody');
  if (!d) return;
  // Pas de socket Docker (installation sans Docker, LXC…) : le panneau n'a rien à montrer.
  const notInstalled = !d.available && /ENOENT|ECONNREFUSED/.test(d.error || '');
  $('#dockerSection').hidden = notInstalled;
  if (notInstalled) return;
  if (!d.available) {
    $('#dockerSummary').textContent = '';
    body.replaceChildren(h('p', { class: 'muted' }, /EACCES/.test(d.error || '')
      ? t('docker.eacces')
      : t('docker.unreachable', { error: d.error })));
    return;
  }
  const running = d.containers.filter((c) => c.state === 'running').length;
  $('#dockerSummary').textContent = t('docker.running', { running, total: d.containers.length });
  if (!d.containers.length) {
    body.replaceChildren(h('p', { class: 'muted' }, t('docker.none')));
    return;
  }
  body.replaceChildren(h('div', { class: 'containers' }, d.containers.map((c) => {
    const dotClass = c.state === 'running' ? 'ok' : c.state === 'restarting' || c.state === 'paused' ? 'warn' : 'bad';
    const actions = h('div', { class: 'actions' });
    if (state.authed) {
      if (c.state === 'running') {
        actions.append(
          h('button', { class: 'btn btn-sm', onclick: (e) => dockerAction(c, 'restart', e.target) }, t('docker.restart')),
          h('button', { class: 'btn btn-sm', onclick: (e) => dockerAction(c, 'stop', e.target) }, t('docker.stop')));
      } else {
        actions.append(h('button', { class: 'btn btn-sm', onclick: (e) => dockerAction(c, 'start', e.target) }, t('docker.start')));
      }
    }
    return h('div', { class: 'container-row' },
      h('span', { class: `dot ${dotClass}`, title: c.state }),
      h('span', { class: 'name', title: c.name }, c.name),
      h('span', { class: 'image', title: c.image }, c.image),
      h('span', { class: 'status' }, c.status),
      actions);
  })));
}

const ACTION_DONE = { start: 'docker.started', stop: 'docker.stopped', restart: 'docker.restarted' };

async function dockerAction(c, action, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await api(`/api/docker/containers/${c.id}/${action}`, { method: 'POST' });
    toast(t(ACTION_DONE[action], { name: c.name }));
  } catch (e) {
    toast(errMsg(e), true);
  }
  refreshDocker();
}

// ---------- Horloge ----------
function tickClock() {
  $('#clock').textContent = new Date().toLocaleString(LOCALE, {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

// ---------- Thème ----------
// Le bouton montre le thème vers lequel on bascule (☀️ en sombre, 🌙 en clair).
function renderThemeBtn() {
  const toLight = currentTheme() === 'dark';
  const btn = $('#themeBtn');
  btn.textContent = toLight ? '☀️' : '🌙';
  btn.title = t(toLight ? 'theme.toLight' : 'theme.toDark');
  btn.setAttribute('aria-label', btn.title);
}

// Éléments de la barre du haut que l'admin a choisi d'afficher (tous par défaut).
const displayOptions = (cfg) => ({ search: true, theme: true, lang: true, ...cfg.display });

// ---------- Recherche rapide ----------
// « / » place le curseur dans le champ (et l'ouvre si la barre est masquée),
// Échap le vide, Entrée ouvre la première tuile.
function bindSearch() {
  const input = $('#search');
  const close = () => { state.searchOpen = false; render(); };
  input.addEventListener('input', () => { state.search = input.value; render(); });
  input.addEventListener('blur', () => { if (!input.value) close(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = state.search = '';
      input.blur();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      $('#board a.tile')?.click();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || !state.searchEnabled) return;
    if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (input.hidden) { state.searchOpen = true; render(); }
    input.focus();
  });
}

// ---------- Démarrage ----------
async function init() {
  applyStaticI18n();
  $('#langBtn').addEventListener('click', () => setLang(LANG === 'fr' ? 'en' : 'fr'));
  renderThemeBtn();
  bindSearch();
  // Nombre de colonnes de la grille selon la largeur disponible.
  new ResizeObserver(layoutBoard).observe($('#board'));
  ['#stat-cpu', '#stat-mem', '#stat-up'].forEach((id) => makeStatDraggable($(id)));
  // En édition, pas de glisser natif (images, liens) : il couperait celui au pointeur.
  document.addEventListener('dragstart', (e) => { if (state.editing) e.preventDefault(); });
  $('#themeBtn').addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    renderThemeBtn();
  });
  // Sans choix enregistré, suivre le système quand il change.
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', renderThemeBtn);
  $('#editBtn').addEventListener('click', startEditing);
  $('#cancelBtn').addEventListener('click', () => { if (confirmDiscard()) stopEditing(); });
  $('#saveBtn').addEventListener('click', save);
  $('#discardBtn').addEventListener('click', discardChanges);
  // Ctrl / Cmd + S enregistre en mode édition (au lieu d'enregistrer la page HTML).
  document.addEventListener('keydown', (e) => {
    if (!state.editing || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
    e.preventDefault();
    if (isDirty() && !$('#saveBtn').disabled) save();
  });
  // Fermer l'onglet ou recharger avec des modifications : le navigateur demande confirmation.
  window.addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });
  $('#authBtn').addEventListener('click', onAuthClick);
  $('#addCatBtn').addEventListener('click', async () => {
    const name = await askText(t('category.new'), t('common.name'));
    if (name) { state.draft.categories.push({ id: uid('cat'), name, apps: [] }); render(); }
  });
  $('#renameBoardBtn').addEventListener('click', async () => {
    const title = await askText(t('board.rename'), t('common.title'), state.draft.title);
    if (title) { state.draft.title = title; render(); }
  });
  $('#addWidgetBtn').addEventListener('click', () => openWidgetDialog());
  $('#disksBtn').addEventListener('click', openDisksDialog);
  $('#disksForm').addEventListener('submit', submitDisks);
  $('#displayBtn').addEventListener('click', openDisplayDialog);
  $('#displayForm').addEventListener('submit', submitDisplay);
  $('#widgetForm').addEventListener('submit', submitWidget);
  $('#widgetForm').elements.type.addEventListener('change', updateWidgetFields);
  $('#widgetForm').elements.clearApiKey.addEventListener('change', syncClearBoxes);
  $('#widgetForm').elements.clearPassword.addEventListener('change', syncClearBoxes);
  $('#loginForm').addEventListener('submit', submitLogin);
  $('#appForm').addEventListener('submit', submitApp);
  $('#textForm').addEventListener('submit', (e) => { e.preventDefault(); $('#textDialog').close('ok'); });
  document.querySelectorAll('dialog').forEach(bindCloseButtons);

  tickClock();
  setInterval(tickClock, 10_000);

  const me = await api('/api/me');
  state.authed = me.authenticated;
  state.defaultPassword = me.defaultPassword;
  state.loginRequired = me.loginRequired;
  if (state.loginRequired && !state.authed) return showLoginGate();

  state.config = await api('/api/config');
  if (!displayOptions(state.config).lang) followBrowserLang();
  render();

  refreshSystem();
  refreshStatus();
  refreshDocker();
  scheduleWidgets();
  setInterval(refreshSystem, 5_000);
  setInterval(refreshStatus, 30_000);
  setInterval(refreshDocker, 10_000);
}

// Page vide avec un message à la place du tableau (connexion requise, erreur de chargement…).
function showBlocker(message, action) {
  $('#stats').hidden = true;
  $('#dockerSection').hidden = true;
  itemObserver.disconnect();
  $('#board').replaceChildren();
  boardMessage(h('div', { class: 'empty' }, h('p', {}, message), action));
}

function showLoginGate() {
  $('#authBtn').textContent = t('btn.login');
  showBlocker(t('gate.private'), h('button', { class: 'btn btn-primary', onclick: onAuthClick }, t('login.submit')));
  onAuthClick();
}

init().catch((e) => showBlocker(t('gate.loadError', { error: errMsg(e) })));
