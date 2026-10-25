// Server Dashboard — interface web
const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,     // config enregistrée
  draft: null,      // copie modifiée en mode édition
  status: {},       // { appId: { online, code, ms } }
  authed: false,
  loginRequired: false, // REQUIRE_LOGIN côté serveur
  editing: false,
  docker: null,
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
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2800);
}

const fmtBytes = (b) => {
  if (!b && b !== 0) return '–';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

const fmtUptime = (s) => {
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} j ${hh} h` : hh ? `${hh} h ${m} min` : `${m} min`;
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

function render() {
  const cfg = current();
  if (!cfg) return;
  document.title = cfg.title;
  $('#title').textContent = cfg.title;
  document.body.classList.toggle('editing', state.editing);
  $('#editBar').hidden = !state.editing;
  $('#editBtn').hidden = !state.authed || state.editing;
  $('#authBtn').textContent = state.authed ? 'Déconnexion' : 'Connexion';

  const board = $('#board');
  board.replaceChildren();

  if (!cfg.categories.length) {
    board.append(h('div', { class: 'empty' },
      state.authed ? 'Aucune catégorie. Passe en mode édition pour en ajouter.' : 'Aucune application configurée.'));
  }

  cfg.categories.forEach((cat, ci) => {
    if (!state.editing && !cat.apps.length) return;
    const head = h('div', { class: 'category-head' }, h('h2', {}, cat.name));
    if (state.editing) {
      head.append(h('div', { class: 'category-tools' },
        h('button', { class: 'icon-btn', title: 'Monter', disabled: ci === 0, onclick: () => moveCategory(ci, -1) }, '↑'),
        h('button', { class: 'icon-btn', title: 'Descendre', disabled: ci === cfg.categories.length - 1, onclick: () => moveCategory(ci, 1) }, '↓'),
        h('button', { class: 'icon-btn', title: 'Renommer', onclick: () => renameCategory(ci) }, '✎'),
        h('button', { class: 'icon-btn danger', title: 'Supprimer', onclick: () => deleteCategory(ci) }, '✕'),
      ));
    }

    const grid = h('div', { class: 'grid', 'data-cat': ci });
    cat.apps.forEach((app, ai) => grid.append(tileEl(app, ci, ai)));
    if (state.editing) {
      grid.append(h('button', { class: 'add-tile', onclick: () => openAppDialog(ci) }, '+ Ajouter une app'));
      bindGridDrop(grid, ci);
    }
    board.append(h('section', { class: 'category' }, head, grid));
  });

  renderWidgets();
}

function statusDot(app) {
  const s = state.status[app.id];
  if (!s) return h('span', { class: 'dot', title: 'Vérification…' });
  if (!s.online) return h('span', { class: 'dot bad', title: `Hors ligne${s.error ? ' : ' + s.error : ''}` });
  const slow = s.ms > 1500;
  return h('span', { class: `dot ${slow ? 'warn' : 'ok'}`, title: `En ligne · HTTP ${s.code} · ${s.ms} ms` });
}

function tileEl(app, ci, ai) {
  const text = h('div', { class: 'tile-text' },
    h('div', { class: 'tile-name' }, app.name),
    app.description ? h('div', { class: 'tile-desc' }, app.description) : null);

  if (!state.editing) {
    return h('a', { class: 'tile', href: app.url, target: '_blank', rel: 'noopener', title: app.url },
      iconEl(app), text, statusDot(app));
  }

  const tile = h('div', { class: 'tile', draggable: 'true', 'data-cat': ci, 'data-app': ai },
    iconEl(app), text,
    h('div', { class: 'tile-tools' },
      h('button', { class: 'icon-btn', title: 'Modifier', onclick: () => openAppDialog(ci, ai) }, '✎'),
      h('button', { class: 'icon-btn danger', title: 'Supprimer', onclick: () => deleteApp(ci, ai) }, '✕')));

  tile.addEventListener('dragstart', (e) => {
    dragged = { ci, ai };
    tile.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${ci}:${ai}`);
  });
  tile.addEventListener('dragend', () => { dragged = null; render(); });
  tile.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    tile.classList.add('drop-before');
  });
  tile.addEventListener('dragleave', () => tile.classList.remove('drop-before'));
  tile.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    moveApp(dragged, ci, ai);
  });
  return tile;
}

// ---------- Widgets d'intégration ----------
const WIDGET_TYPES = {
  proxmox: {
    label: 'Proxmox VE', icon: 'proxmox', kind: 'proxmox', refresh: 10_000, fields: ['url', 'username', 'apiKey'],
    scheme: 'https', port: 8006,
    userLabel: 'Identifiant du jeton', userHelp: 'Ex. root@pam!dashboard', userRequired: true,
    keyLabel: 'Secret du jeton', keyHelp: 'Datacenter > Permissions > API Tokens (rôle PVEAuditor, lecture seule).',
  },
  jellyfin: { label: 'Jellyfin', icon: 'jellyfin', kind: 'media', refresh: 10_000, keyLabel: 'Clé API', keyHelp: 'Jellyfin > Tableau de bord > Clés API.', port: 8096 },
  plex: { label: 'Plex', icon: 'plex', kind: 'media', refresh: 10_000, keyLabel: 'Token Plex', keyHelp: 'Valeur X-Plex-Token de ton compte (doc Plex : « Finding an authentication token »).', port: 32400 },
  qbittorrent: { label: 'qBittorrent', icon: 'qbittorrent', kind: 'torrent', refresh: 5_000, fields: ['url', 'username', 'password'], port: 8080 },
  sonarr: { label: 'Sonarr', icon: 'sonarr', kind: 'arr', refresh: 60_000, keyLabel: 'Clé API', keyHelp: 'Sonarr > Settings > General > API Key.', port: 8989 },
  radarr: { label: 'Radarr', icon: 'radarr', kind: 'arr', refresh: 60_000, keyLabel: 'Clé API', keyHelp: 'Radarr > Settings > General > API Key.', port: 7878 },
};
const fieldsOf = (type) => WIDGET_TYPES[type].fields || ['url', 'apiKey'];

state.widgetData = {}; // { widgetId: { data } | { error } }
let widgetTimers = [];

const fmtSpeed = (b) => `${fmtBytes(b)}/s`;
const fmtEta = (s) => (s == null || s >= 8640000 ? '∞' : s < 60 ? `${s} s` : fmtUptime(s));
const pct = (p) => `${Math.round(Math.min(1, Math.max(0, p || 0)) * 100)} %`;

function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 864e5);
  // Les dates Radarr sont à minuit UTC : l'heure n'a pas de sens.
  const time = d.getUTCHours() || d.getUTCMinutes()
    ? ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
  if (diff === 0) return `Aujourd'hui${time}`;
  if (diff === 1) return `Demain${time}`;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + time;
}

function progressBar(p, cls = '') {
  return h('div', { class: 'bar bar-thin' }, h('i', { class: cls, style: `width:${Math.min(100, (p || 0) * 100)}%` }));
}

const RENDERERS = {
  media: (d) => [
    h('div', { class: 'widget-stats' }, d.stats.map((s) =>
      h('div', {}, h('b', {}, (s.value ?? 0).toLocaleString('fr-FR')), h('span', {}, s.label)))),
    d.sessions.length
      ? h('ul', { class: 'widget-list' }, d.sessions.map((s) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: s.title }, `${s.paused ? '⏸' : '▶'} ${s.title}`),
          h('span', { class: 'muted' }, s.user || '')),
        h('div', { class: 'item-sub' }, [s.subtitle, s.device].filter(Boolean).join(' · ')),
        progressBar(s.progress, s.paused ? 'warn' : ''))))
      : h('p', { class: 'muted' }, 'Aucune lecture en cours.'),
  ],

  torrent: (d) => [
    h('div', { class: 'widget-stats' },
      h('div', {}, h('b', {}, fmtSpeed(d.download)), h('span', {}, '↓ Reçu')),
      h('div', {}, h('b', {}, fmtSpeed(d.upload)), h('span', {}, '↑ Envoyé')),
      h('div', {}, h('b', {}, `${d.counts.downloading} / ${d.counts.seeding}`), h('span', {}, 'DL / seed'))),
    d.torrents.length
      ? h('ul', { class: 'widget-list' }, d.torrents.map((t) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: t.name }, t.name),
          h('span', { class: 'muted' }, pct(t.progress))),
        h('div', { class: 'item-sub' }, t.group === 'downloading'
          ? `↓ ${fmtSpeed(t.dlspeed)} · reste ${fmtEta(t.eta)}`
          : t.group === 'seeding' ? `↑ ${fmtSpeed(t.upspeed)} · ${fmtBytes(t.size)}`
            : t.group === 'error' ? 'Erreur' : `En pause · ${fmtBytes(t.size)}`),
        progressBar(t.progress, t.group === 'error' ? 'bad' : t.group === 'paused' ? 'warn' : ''))))
      : h('p', { class: 'muted' }, 'Aucun torrent.'),
  ],

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
          h('span', { class: 'muted' }, n.online ? `en ligne depuis ${fmtUptime(n.uptime)}` : 'hors ligne')),
        n.online ? [
          meter('CPU', n.cpu, `${pct(n.cpu)} · ${n.cores} cœurs`),
          meter('RAM', n.mem / n.maxmem, `${fmtBytes(n.mem)} / ${fmtBytes(n.maxmem)}`),
          meter('Disque', n.disk / n.maxdisk, `${fmtBytes(n.disk)} / ${fmtBytes(n.maxdisk)}`),
        ] : null)),
      h('div', { class: 'widget-subhead' }, `VM et conteneurs · ${d.running} / ${d.guests.length} démarrés`),
      d.guests.length
        ? h('ul', { class: 'widget-list' }, d.guests.map((g) => h('li', {},
          h('div', { class: 'row' },
            h('span', { class: 'item-title', title: `${g.type} ${g.id} · ${g.name}` },
              h('span', { class: `dot ${g.running ? 'ok' : ''}` }), ' ',
              h('span', { class: 'badge' }, g.type), ` ${g.id} · ${g.name}`),
            h('span', { class: 'muted' }, g.running ? `${pct(g.cpu)} CPU · ${pct(g.mem)} RAM` : 'arrêté')),
          multiNode ? h('div', { class: 'item-sub' }, g.node) : null)))
        : h('p', { class: 'muted' }, 'Aucune VM ni conteneur.'),
      d.storages.length ? h('div', { class: 'widget-subhead' }, 'Stockages') : null,
      ...d.storages.map((s) => meter(multiNode ? `${s.name} (${s.node})` : s.name, s.used / s.total,
        `${fmtBytes(s.used)} / ${fmtBytes(s.total)}`)),
    ];
  },

  arr: (d) => [
    h('div', { class: 'widget-subhead' }, 'À venir'),
    d.upcoming.length
      ? h('ul', { class: 'widget-list' }, d.upcoming.map((e) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: e.title }, e.title),
          h('span', { class: e.hasFile ? 'badge ok' : 'muted' }, e.hasFile ? 'Disponible' : fmtDay(e.date))),
        h('div', { class: 'item-sub' }, e.subtitle))))
      : h('p', { class: 'muted' }, 'Rien de prévu.'),
    h('div', { class: 'widget-subhead' }, `File d'attente · ${d.queue.total}`),
    d.queue.items.length
      ? h('ul', { class: 'widget-list' }, d.queue.items.map((q) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: q.title }, q.title),
          h('span', { class: 'muted' }, pct(q.progress))),
        h('div', { class: 'item-sub' }, [q.status, q.timeleft && `reste ${q.timeleft}`].filter(Boolean).join(' · ')),
        progressBar(q.progress))))
      : h('p', { class: 'muted' }, 'Aucun téléchargement.'),
  ],
};

function renderWidgets() {
  const widgets = current().widgets || [];
  const box = $('#widgets');
  box.hidden = !widgets.length;
  box.replaceChildren(...widgets.map((w, i) => widgetCard(w, i, widgets.length)));
}

function widgetCard(w, i, count) {
  const t = WIDGET_TYPES[w.type];
  const head = h('div', { class: 'widget-head' },
    iconEl({ name: w.name, icon: t.icon }),
    h('a', { class: 'widget-title', href: w.url, target: '_blank', rel: 'noopener', draggable: state.editing ? 'false' : null }, w.name || t.label));
  const card = h('article', { class: `widget widget-${t.kind}`, 'data-widget': w.id }, head, widgetBody(w));
  if (!state.editing) return card;

  // Les flèches restent utiles sur écran tactile, où le glisser-déposer HTML5 ne marche pas.
  head.append(h('div', { class: 'tile-tools' },
    h('button', { class: 'icon-btn', title: 'Vers la gauche', disabled: i === 0, onclick: () => moveWidget(i, i - 1) }, '←'),
    h('button', { class: 'icon-btn', title: 'Vers la droite', disabled: i === count - 1, onclick: () => moveWidget(i, i + 2) }, '→'),
    h('button', { class: 'icon-btn', title: 'Modifier', onclick: () => openWidgetDialog(i) }, '✎'),
    h('button', { class: 'icon-btn danger', title: 'Supprimer', onclick: () => deleteWidget(i) }, '✕')));

  card.draggable = true;
  card.addEventListener('dragstart', (e) => {
    draggedWidget = i;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `widget:${i}`);
  });
  card.addEventListener('dragend', () => { draggedWidget = null; render(); });
  card.addEventListener('dragover', (e) => {
    if (draggedWidget == null || draggedWidget === i) return;
    e.preventDefault();
    // Déposé sur la moitié gauche : avant ce widget ; moitié droite : après.
    const after = e.clientX > card.getBoundingClientRect().left + card.offsetWidth / 2;
    card.classList.toggle('drop-before', !after);
    card.classList.toggle('drop-after', after);
  });
  card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
  card.addEventListener('drop', (e) => {
    if (draggedWidget == null) return;
    e.preventDefault();
    const after = card.classList.contains('drop-after');
    moveWidget(draggedWidget, after ? i + 1 : i);
  });
  return card;
}

let draggedWidget = null;

function widgetBody(w) {
  const entry = state.widgetData[w.id];
  const saved = state.config.widgets.some((x) => x.id === w.id);
  let content;
  if (!saved) content = h('p', { class: 'muted' }, 'Enregistre pour charger les données.');
  else if (!entry) content = h('p', { class: 'muted' }, 'Chargement…');
  else if (entry.error) content = h('p', { class: 'error' }, `⚠ ${entry.error}`);
  else content = RENDERERS[WIDGET_TYPES[w.type].kind](entry.data);
  return h('div', { class: 'widget-body' }, content);
}

function updateWidget(id) {
  const card = document.querySelector(`[data-widget="${CSS.escape(id)}"]`);
  const w = current().widgets.find((x) => x.id === id);
  if (card && w) card.querySelector('.widget-body').replaceWith(widgetBody(w));
}

async function refreshWidget(id) {
  try {
    state.widgetData[id] = { data: await api(`/api/widgets/${encodeURIComponent(id)}`) };
  } catch (e) {
    state.widgetData[id] = { error: e.message };
  }
  updateWidget(id);
}

function scheduleWidgets() {
  widgetTimers.forEach(clearInterval);
  widgetTimers = [];
  state.widgetData = {};
  for (const w of state.config.widgets) {
    refreshWidget(w.id);
    widgetTimers.push(setInterval(() => refreshWidget(w.id), WIDGET_TYPES[w.type].refresh));
  }
}

// Déplace le widget `from` juste avant la position `to` (to = longueur : à la fin).
function moveWidget(from, to) {
  const list = state.draft.widgets;
  const [w] = list.splice(from, 1);
  if (from < to) to--;
  list.splice(to, 0, w);
  draggedWidget = null;
  render();
}

function deleteWidget(i) {
  const w = state.draft.widgets[i];
  if (!confirm(`Supprimer le widget « ${w.name} » ?`)) return;
  state.draft.widgets.splice(i, 1);
  render();
}

let widgetDialogIndex = null;

function openWidgetDialog(i) {
  widgetDialogIndex = i ?? null;
  const w = i != null ? state.draft.widgets[i] : { type: 'jellyfin' };
  const f = $('#widgetForm').elements;
  $('#widgetDialogTitle').textContent = i != null ? 'Modifier le widget' : 'Nouveau widget';
  f.type.replaceChildren(...Object.entries(WIDGET_TYPES).map(([k, t]) =>
    h('option', { value: k, selected: k === w.type }, t.label)));
  f.type.disabled = i != null; // changer de type mélangerait les identifiants
  f.name.value = w.name || '';
  f.url.value = w.url || '';
  f.username.value = w.username || '';
  f.apiKey.value = '';
  f.password.value = '';
  f.apiKey.placeholder = w.hasApiKey ? '•••••••• (inchangée)' : '';
  f.password.placeholder = w.hasPassword ? '•••••••• (inchangé)' : '';
  updateWidgetFields();
  $('#widgetDialog').showModal();
}

function updateWidgetFields() {
  const form = $('#widgetForm');
  const type = form.elements.type.value;
  const t = WIDGET_TYPES[type];
  const fields = fieldsOf(type);
  const w = widgetDialogIndex != null ? state.draft.widgets[widgetDialogIndex] : {};
  form.querySelectorAll('[data-field]').forEach((label) => {
    const on = fields.includes(label.dataset.field);
    label.hidden = !on;
    label.querySelector('input').disabled = !on;
  });
  form.querySelector('[data-key-label]').textContent = t.keyLabel || 'Clé API';
  form.querySelector('[data-key-help]').textContent = t.keyHelp || '';
  form.elements.apiKey.required = fields.includes('apiKey') && !w.hasApiKey;
  form.elements.username.required = !!t.userRequired;
  form.querySelector('[data-user-label]').textContent = t.userLabel || 'Utilisateur';
  form.elements.username.placeholder = t.userHelp || '';
  form.elements.url.placeholder = `${t.scheme || 'http'}://192.168.1.10:${t.port}`;
}

function submitWidget(e) {
  e.preventDefault();
  const f = e.target.elements;
  const type = f.type.value;
  const fields = fieldsOf(type);
  const prev = widgetDialogIndex != null ? state.draft.widgets[widgetDialogIndex] : null;
  const w = {
    id: prev?.id || uid('wid'),
    type,
    name: f.name.value.trim() || WIDGET_TYPES[type].label,
    url: f.url.value.trim(),
    hasApiKey: prev?.hasApiKey,
    hasPassword: prev?.hasPassword,
  };
  if (fields.includes('apiKey')) w.apiKey = f.apiKey.value.trim();
  if (fields.includes('username')) w.username = f.username.value.trim();
  if (fields.includes('password')) w.password = f.password.value;
  if (prev) state.draft.widgets[widgetDialogIndex] = w;
  else state.draft.widgets.push(w);
  $('#widgetDialog').close();
  render();
}

// ---------- Glisser-déposer ----------
let dragged = null;

function bindGridDrop(grid, ci) {
  grid.addEventListener('dragover', (e) => { if (dragged) { e.preventDefault(); grid.classList.add('drag-over'); } });
  grid.addEventListener('dragleave', (e) => { if (!grid.contains(e.relatedTarget)) grid.classList.remove('drag-over'); });
  grid.addEventListener('drop', (e) => {
    e.preventDefault();
    moveApp(dragged, ci, state.draft.categories[ci].apps.length);
  });
}

function moveApp(from, toCat, toIndex) {
  if (!from) return;
  const cats = state.draft.categories;
  const [app] = cats[from.ci].apps.splice(from.ai, 1);
  // Si on déplace vers la droite dans la même catégorie, l'index cible a reculé d'un cran.
  if (from.ci === toCat && from.ai < toIndex) toIndex--;
  cats[toCat].apps.splice(toIndex, 0, app);
  dragged = null;
  render();
}

// ---------- Actions d'édition ----------
function moveCategory(ci, delta) {
  const cats = state.draft.categories;
  [cats[ci], cats[ci + delta]] = [cats[ci + delta], cats[ci]];
  render();
}

async function renameCategory(ci) {
  const name = await askText('Renommer la catégorie', 'Nom', state.draft.categories[ci].name);
  if (name) { state.draft.categories[ci].name = name; render(); }
}

function deleteCategory(ci) {
  const cat = state.draft.categories[ci];
  if (cat.apps.length && !confirm(`Supprimer « ${cat.name} » et ses ${cat.apps.length} app(s) ?`)) return;
  state.draft.categories.splice(ci, 1);
  render();
}

function deleteApp(ci, ai) {
  const app = state.draft.categories[ci].apps[ai];
  if (!confirm(`Supprimer « ${app.name} » ?`)) return;
  state.draft.categories[ci].apps.splice(ai, 1);
  render();
}

function startEditing() {
  state.draft = structuredClone(state.config);
  state.editing = true;
  render();
}

function stopEditing() {
  state.editing = false;
  state.draft = null;
  render();
}

async function save() {
  const btn = $('#saveBtn');
  btn.disabled = true;
  try {
    state.config = await api('/api/config', { method: 'PUT', body: state.draft });
    stopEditing();
    toast('Configuration enregistrée');
    refreshStatus();
    scheduleWidgets();
  } catch (e) {
    toast(e.message, true);
    if (e.message === 'Non authentifié') { state.authed = false; render(); }
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
  $('#appDialogTitle').textContent = ai != null ? 'Modifier l\'application' : 'Nouvelle application';
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
    await api('/api/logout', { method: 'POST' });
    if (state.loginRequired) return location.reload();
    state.authed = false;
    stopEditing();
    renderDocker();
    toast('Déconnecté');
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
    $('#loginDialog').close();
    render();
    renderDocker();
    toast('Connecté');
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
}

// ---------- Stats système ----------
function setStat(id, pct, value, sub) {
  const el = $(id);
  el.querySelector('b').textContent = value;
  el.querySelector('small').textContent = sub;
  const bar = el.querySelector('.bar i');
  if (bar) {
    bar.style.width = `${Math.min(100, pct)}%`;
    bar.className = pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : '';
  }
}

async function refreshSystem() {
  try {
    const s = await api('/api/system');
    $('#host').textContent = s.hostname;
    setStat('#stat-cpu', s.cpu.usage, `${s.cpu.usage.toFixed(0)} %`,
      `${s.cpu.cores} cœurs · charge ${s.cpu.load.map((l) => l.toFixed(2)).join(' ')}`);
    const memPct = (s.memory.used / s.memory.total) * 100;
    setStat('#stat-mem', memPct, `${memPct.toFixed(0)} %`, `${fmtBytes(s.memory.used)} / ${fmtBytes(s.memory.total)}`);
    if (s.disk.total) {
      const diskPct = (s.disk.used / s.disk.total) * 100;
      setStat('#stat-disk', diskPct, `${diskPct.toFixed(0)} %`, `${fmtBytes(s.disk.used)} / ${fmtBytes(s.disk.total)} · ${s.disk.path}`);
    } else {
      setStat('#stat-disk', 0, '–', s.disk.error || 'indisponible');
    }
    setStat('#stat-up', 0, fmtUptime(s.uptime), s.platform);
  } catch { /* le serveur est peut-être en train de redémarrer */ }
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
      ? 'Accès au socket Docker refusé : ajoute l\'utilisateur du dashboard au groupe « docker ».'
      : `Docker non joignable : ${d.error}`));
    return;
  }
  const running = d.containers.filter((c) => c.state === 'running').length;
  $('#dockerSummary').textContent = `${running} / ${d.containers.length} en cours d'exécution`;
  if (!d.containers.length) {
    body.replaceChildren(h('p', { class: 'muted' }, 'Aucun conteneur.'));
    return;
  }
  body.replaceChildren(h('div', { class: 'containers' }, d.containers.map((c) => {
    const dotClass = c.state === 'running' ? 'ok' : c.state === 'restarting' || c.state === 'paused' ? 'warn' : 'bad';
    const actions = h('div', { class: 'actions' });
    if (state.authed) {
      if (c.state === 'running') {
        actions.append(
          h('button', { class: 'btn btn-sm', onclick: (e) => dockerAction(c, 'restart', e.target) }, 'Redémarrer'),
          h('button', { class: 'btn btn-sm', onclick: (e) => dockerAction(c, 'stop', e.target) }, 'Arrêter'));
      } else {
        actions.append(h('button', { class: 'btn btn-sm', onclick: (e) => dockerAction(c, 'start', e.target) }, 'Démarrer'));
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

const ACTION_LABELS = { start: 'démarré', stop: 'arrêté', restart: 'redémarré' };

async function dockerAction(c, action, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await api(`/api/docker/containers/${c.id}/${action}`, { method: 'POST' });
    toast(`${c.name} ${ACTION_LABELS[action]}`);
  } catch (e) {
    toast(e.message, true);
  }
  refreshDocker();
}

// ---------- Horloge ----------
function tickClock() {
  $('#clock').textContent = new Date().toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

// ---------- Démarrage ----------
async function init() {
  $('#editBtn').addEventListener('click', startEditing);
  $('#cancelBtn').addEventListener('click', stopEditing);
  $('#saveBtn').addEventListener('click', save);
  $('#authBtn').addEventListener('click', onAuthClick);
  $('#addCatBtn').addEventListener('click', async () => {
    const name = await askText('Nouvelle catégorie', 'Nom');
    if (name) { state.draft.categories.push({ id: uid('cat'), name, apps: [] }); render(); }
  });
  $('#renameBoardBtn').addEventListener('click', async () => {
    const title = await askText('Renommer le tableau', 'Titre', state.draft.title);
    if (title) { state.draft.title = title; render(); }
  });
  $('#addWidgetBtn').addEventListener('click', () => openWidgetDialog());
  $('#widgetForm').addEventListener('submit', submitWidget);
  $('#widgetForm').elements.type.addEventListener('change', updateWidgetFields);
  $('#loginForm').addEventListener('submit', submitLogin);
  $('#appForm').addEventListener('submit', submitApp);
  $('#textForm').addEventListener('submit', (e) => { e.preventDefault(); $('#textDialog').close('ok'); });
  document.querySelectorAll('dialog').forEach(bindCloseButtons);

  tickClock();
  setInterval(tickClock, 10_000);

  const me = await api('/api/me');
  state.authed = me.authenticated;
  state.loginRequired = me.loginRequired;
  if (state.loginRequired && !state.authed) return showLoginGate();

  state.config = await api('/api/config');
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
  $('#widgets').hidden = true;
  $('#dockerSection').hidden = true;
  $('#board').replaceChildren(h('div', { class: 'empty' }, h('p', {}, message), action));
}

function showLoginGate() {
  $('#authBtn').textContent = 'Connexion';
  showBlocker('Ce dashboard est privé : connecte-toi pour y accéder.',
    h('button', { class: 'btn btn-primary', onclick: onAuthClick }, 'Se connecter'));
  onAuthClick();
}

init().catch((e) => showBlocker(`Erreur de chargement : ${e.message}`));
