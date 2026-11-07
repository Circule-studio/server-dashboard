// Courbes d'historique (#136) : fenêtre « Historique » d'une machine et mini-courbes des cartes de stats.
// Du SVG construit à la main, pour garder une seule dépendance. Chargé après app.js : voir CONTRIBUTING.md.

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART_W = 1000;
const CHART_H = 100;
const GAP_FACTOR = 2.5; // plus de 2,5 points manquants : un trou dans la courbe, pas un segment droit
const SERIES_COLORS = ['var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--bad)'];
const SPARK_EVERY_MS = 120_000;

function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

const chartIcon = () => svgEl('svg', { viewBox: '0 0 16 16', width: '14', height: '14', 'aria-hidden': 'true' },
  svgEl('path', { d: 'M1.5 12.5 6 8l3 2.5L14.5 4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

// Bouton « Historique » d'une machine. Rien en mode édition : le widget n'est peut-être pas enregistré.
function historyButton(name, url, cls = '') {
  if (state.editing) return null;
  const label = t('history.open', { name });
  return h('button', { type: 'button', class: `icon-btn history-btn ${cls}`, title: label, 'aria-label': label, onclick: () => openHistory(name, url) }, chartIcon());
}

const widgetHistoryUrl = (w, query = {}) => {
  const params = new URLSearchParams(query).toString();
  return `/api/widgets/${encodeURIComponent(w.id)}/history${params ? `?${params}` : ''}`;
};

const fmtPercent = (v) => `${Math.round(v)} %`;
const fmtRate = (v) => `${fmtBytes(v)}/s`;

// ---------- Une courbe ----------
// Segments continus d'une série : une valeur inconnue ou un long silence coupent la ligne.
function segments(data, values) {
  const out = [];
  let current = null;
  data.t.forEach((time, i) => {
    const v = values[i];
    if (v == null) {
      current = null;
      return;
    }
    if (current && time - data.t[i - 1] > data.step * GAP_FACTOR) current = null;
    if (!current) out.push((current = []));
    current.push([time, v]);
  });
  return out;
}

function chartPaths(data, series, max) {
  const span = data.to - data.from;
  const xOf = (time) => ((time - data.from) / span) * CHART_W;
  const yOf = (v) => CHART_H - (Math.min(v, max) / max) * CHART_H;
  return series.flatMap((s) => segments(data, s.values).flatMap((seg) => {
    const pts = seg.map(([time, v]) => `${xOf(time).toFixed(1)} ${yOf(v).toFixed(2)}`);
    // Un point seul serait invisible : un petit trait à la place.
    const line = seg.length > 1 ? `M${pts.join('L')}` : `M${pts[0]}h3`;
    const paths = [svgEl('path', { d: line, class: 'chart-line', style: `stroke:${s.color}`, 'vector-effect': 'non-scaling-stroke' })];
    if (series.length === 1 && seg.length > 1) {
      const area = `${line}L${xOf(seg.at(-1)[0]).toFixed(1)} ${CHART_H}L${xOf(seg[0][0]).toFixed(1)} ${CHART_H}Z`;
      paths.unshift(svgEl('path', { d: area, class: 'chart-area', style: `fill:${s.color}` }));
    }
    return paths;
  }));
}

function fmtMoment(seconds, range) {
  const date = new Date(seconds * 1000);
  const time = date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  return range === 'day' ? time : `${date.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric' })} ${time}`;
}

function xLabels(data) {
  const steps = 4;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const time = data.from + ((data.to - data.from) * i) / steps;
    const date = new Date(time * 1000);
    return h('span', {}, data.range === 'day'
      ? date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric' }));
  });
}

function seriesSummary(s) {
  const known = s.values.filter((v) => v != null);
  if (!known.length) return null;
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  return t('history.avgMax', { avg: s.fmt(avg), max: s.fmt(Math.max(...known)) });
}

function chartEl(title, series, data, max, maxLabel) {
  const cursor = h('div', { class: 'chart-cursor', hidden: true });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const plot = h('div', { class: 'chart-plot', role: 'img', 'aria-label': `${title} : ${series.map(seriesSummary).filter(Boolean).join(' ; ')}` },
    svgEl('svg', { viewBox: `0 0 ${CHART_W} ${CHART_H}`, preserveAspectRatio: 'none' },
      ...[25, 50, 75].map((y) => svgEl('line', { x1: 0, x2: CHART_W, y1: y, y2: y, class: 'chart-grid', 'vector-effect': 'non-scaling-stroke' })),
      ...chartPaths(data, series, max)),
    h('span', { class: 'chart-max' }, maxLabel),
    cursor, tip);

  // Survol : le point le plus proche, ou l'absence de données s'il est trop loin.
  const show = (e) => {
    const box = plot.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const time = data.from + ratio * (data.to - data.from);
    let nearest = -1;
    data.t.forEach((x, i) => {
      if (nearest < 0 || Math.abs(x - time) < Math.abs(data.t[nearest] - time)) nearest = i;
    });
    const near = nearest >= 0 && Math.abs(data.t[nearest] - time) <= data.step * GAP_FACTOR;
    const lines = near
      ? series.map((s) => (s.values[nearest] == null ? null : h('div', {}, s.label ? `${s.label} : ` : '', h('b', {}, s.tip ? s.tip(nearest) : s.fmt(s.values[nearest])))))
      : [];
    cursor.hidden = false;
    cursor.style.left = `${ratio * 100}%`;
    tip.hidden = false;
    tip.style.left = ratio > 0.6 ? 'auto' : `calc(${ratio * 100}% + 10px)`;
    tip.style.right = ratio > 0.6 ? `calc(${(1 - ratio) * 100}% + 10px)` : 'auto';
    const known = lines.filter(Boolean);
    tip.replaceChildren(h('div', { class: 'muted' }, fmtMoment(near ? data.t[nearest] : time, data.range)), ...(known.length ? known : [h('div', {}, t('history.noData'))]));
  };
  plot.addEventListener('pointermove', show);
  plot.addEventListener('pointerdown', show);
  plot.addEventListener('pointerleave', () => {
    cursor.hidden = true;
    tip.hidden = true;
  });

  const multi = series.length > 1;
  return h('section', { class: 'chart' },
    h('div', { class: 'chart-head' },
      h('h4', {}, title),
      h('div', { class: 'chart-legend' }, series.map((s) => h('span', {},
        multi ? h('i', { style: `background:${s.color}` }) : null,
        multi ? `${s.label} · ` : '',
        seriesSummary(s) || '–')))),
    plot,
    h('div', { class: 'chart-x' }, xLabels(data)));
}

// Échelle du réseau : 1, 2 ou 5 fois une puissance de 10, au-dessus du maximum.
function niceMax(values) {
  const top = Math.max(...values.filter((v) => v != null), 1);
  const power = 10 ** Math.floor(Math.log10(top));
  return [1, 2, 5, 10].map((n) => n * power).find((n) => n >= top);
}

function renderCharts(data) {
  const hasValues = (values) => values.some((v) => v != null);
  // Un seul disque sans nom donné : « Disque » se lit mieux que son chemin.
  const diskName = (d) => (data.disks.length === 1 && d.name === d.path ? t('stat.disk') : d.name);
  const charts = [];
  const percentChart = (title, values) => {
    if (hasValues(values)) charts.push(chartEl(title, [{ values, color: SERIES_COLORS[0], fmt: fmtPercent }], data, 100, '100 %'));
  };
  percentChart(t('stat.cpu'), data.cpu);
  percentChart(t('stat.memory'), data.mem);

  const disks = data.disks.filter((d) => hasValues(d.used)).map((d, i) => ({
    label: diskName(d),
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    fmt: fmtPercent,
    values: d.used.map((u) => (u == null ? null : (u / d.size) * 100)),
    tip: (at) => `${fmtPercent((d.used[at] / d.size) * 100)} · ${fmtBytes(d.used[at])}`,
  }));
  if (disks.length) charts.push(chartEl(t('stat.disk'), disks, data, 100, '100 %'));

  if (hasValues(data.rx) || hasValues(data.tx)) {
    const all = [...data.rx, ...data.tx];
    const top = niceMax(all);
    charts.push(chartEl(t('history.network'), [
      { label: t('history.down'), values: data.rx, color: SERIES_COLORS[0], fmt: fmtRate },
      { label: t('history.up'), values: data.tx, color: SERIES_COLORS[1], fmt: fmtRate },
    ], data, top, fmtRate(top)));
  }

  if (!charts.length) return [h('p', { class: 'muted' }, t('history.empty'))];
  const full = data.disks.filter((d) => d.fillDays != null);
  return [
    ...full.map((d) => h('p', { class: `history-fill ${d.fillDays <= 30 ? 'warn' : ''}` }, `⏳ ${t('history.fill', { name: diskName(d), days: d.fillDays })}`)),
    ...charts,
    h('p', { class: 'muted history-note' }, t('history.gaps')),
  ];
}

// ---------- La fenêtre ----------
const historyView = { name: '', url: '', range: 'day', request: 0 };

async function loadHistory() {
  const request = ++historyView.request;
  const body = $('#historyBody');
  for (const b of $('#historyDialog').querySelectorAll('[data-range]')) b.setAttribute('aria-pressed', String(b.dataset.range === historyView.range));
  body.replaceChildren(h('p', { class: 'muted' }, t('common.loading')));
  const sep = historyView.url.includes('?') ? '&' : '?';
  try {
    const data = await api(`${historyView.url}${sep}range=${historyView.range}`);
    if (request === historyView.request) body.replaceChildren(...renderCharts(data));
  } catch (e) {
    if (request === historyView.request) body.replaceChildren(h('p', { class: 'error' }, `⚠ ${errMsg(e)}`));
  }
}

function openHistory(name, url) {
  Object.assign(historyView, { name, url, range: 'day' });
  $('#historyTitle').textContent = t('history.open', { name });
  $('#historyDialog').showModal();
  loadHistory();
}

// ---------- Mini-courbes des cartes de stats, pour la machine du dashboard ----------
const sparks = { at: 0, series: {} };

function sparkEl(values) {
  const known = values.filter((v) => v != null);
  if (known.length < 2) return null;
  const top = Math.max(50, Math.max(...known) * 1.2); // une charge faible reste lisible, sans exagérer les petits écarts
  const x = (i) => ((i / (values.length - 1)) * 100).toFixed(1);
  const y = (v) => (30 - (Math.min(v, top) / top) * 28).toFixed(2);
  const line = [];
  let first = null;
  let last = null;
  values.forEach((v, i) => {
    if (v == null) return;
    line.push(`${first === null ? 'M' : 'L'}${x(i)} ${y(v)}`);
    first ??= i;
    last = i;
  });
  return svgEl('svg', { class: 'spark', viewBox: '0 0 100 30', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    svgEl('path', { d: `${line.join('')}L${x(last)} 30L${x(first)} 30Z`, class: 'spark-area' }),
    svgEl('path', { d: line.join(''), class: 'spark-line', 'vector-effect': 'non-scaling-stroke' }));
}

function applySparklines() {
  for (const card of document.querySelectorAll('#stats .stat')) {
    card.querySelector('.spark')?.remove();
    const values = sparks.series[card.dataset.stat];
    const spark = values && sparkEl(values);
    if (spark) card.prepend(spark);
    // La carte ouvre l'historique, sauf en mode édition où elle se déplace.
    if (state.editing) card.removeAttribute('role');
    else {
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.title = t('history.open', { name: state.system?.hostname || '' });
    }
  }
}

// Appelé à chaque mise à jour des stats : les cartes de disques sont recréées, les données restent.
async function refreshSparklines() {
  if (Date.now() - sparks.at >= SPARK_EVERY_MS) {
    sparks.at = Date.now();
    try {
      const d = await api('/api/history?range=day');
      sparks.series = {
        cpu: d.cpu,
        mem: d.mem,
        ...Object.fromEntries(d.disks.map((x) => [`disk:${x.path}`, x.used.map((u) => (u == null ? null : (u / x.size) * 100))])),
      };
    } catch { /* pas encore de droits ou serveur en train de redémarrer : réessai au prochain tour */ }
  }
  applySparklines();
}

document.addEventListener('DOMContentLoaded', () => {
  const dialog = $('#historyDialog');
  bindCloseButtons(dialog);
  // Clic en dehors de la fenêtre : elle se ferme.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  for (const b of dialog.querySelectorAll('[data-range]')) {
    b.addEventListener('click', () => {
      historyView.range = b.dataset.range;
      loadHistory();
    });
  }
  const openFromCard = (e) => {
    if (state.editing || !e.target.closest('#stats .stat')) return;
    openHistory(state.system?.hostname || '', '/api/history');
  };
  $('#stats').addEventListener('click', openFromCard);
  $('#stats').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openFromCard(e);
  });
});
