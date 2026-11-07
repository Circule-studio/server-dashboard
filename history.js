// Historique des ressources (#136) : CPU, mémoire, disques et réseau de la machine du dashboard et
// des agents. Pas de base de données : quelques centaines de points par machine, gardés en mémoire
// et recopiés dans data/history.json. Une panne reste visible : aucun point, donc un trou dans la courbe.
// Proxmox VE tient son propre historique (voir integrations/proxmox.js) : rien n'est stocké ici pour lui.

const path = require('path');
const { readJsonFile, writeJsonFileSync } = require('./integrations/lib');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'history.json');
const SAVE_EVERY_MS = 10 * 60_000;
const SAMPLE_EVERY_MS = 60_000;
const FIRST_SAMPLE_MS = 5000; // laisse le temps de mesurer le CPU

// step : secondes couvertes par un point ; span : secondes gardées.
const RANGES = {
  day: { step: 120, span: 86400 },
  week: { step: 900, span: 7 * 86400 },
};
const MIB = 1024 ** 2;
const MAX_NET_GAP_S = 900; // au-delà, une moyenne sur le trou ne dirait rien du débit réel
const FILL_MIN_POINTS = 10;
const FILL_MIN_SPAN_S = 2 * 86400;
const FILL_MAX_DAYS = 365; // au-delà, la tendance n'a plus de sens

const round1 = (v) => Math.round(v * 10) / 10;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Jours avant qu'un disque soit plein, d'après la pente de son occupation (moindres carrés sur les
// points de la semaine). null : pas assez de recul, occupation stable ou en baisse, ou échéance lointaine.
function estimateFill(points, diskPath, size) {
  const known = points.filter((p) => isNum(p.d?.[diskPath]));
  if (!(size > 0) || known.length < FILL_MIN_POINTS || known.at(-1).t - known[0].t < FILL_MIN_SPAN_S) return null;
  const xs = known.map((p) => p.t);
  const ys = known.map((p) => p.d[diskPath] * MIB);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let top = 0;
  let bottom = 0;
  xs.forEach((x, i) => {
    top += (x - meanX) * (ys[i] - meanY);
    bottom += (x - meanX) ** 2;
  });
  const perSecond = top / bottom;
  const remaining = size - ys.at(-1);
  if (!(perSecond > 0) || remaining <= 0) return null;
  const days = remaining / perSecond / 86400;
  return days > FILL_MAX_DAYS ? null : Math.max(1, Math.round(days));
}

// Colonnes envoyées à l'interface. Point : { t, c, m, r, x, d: { disque: Mio utilisés } } ; une valeur
// inconnue vaut null. Sert aussi pour les données de Proxmox.
function buildSeries(points, { range, step, sizes = {}, names = {}, weekPoints = points, now = Date.now() }) {
  const to = Math.floor(now / 1000);
  const column = (key) => points.map((p) => p[key] ?? null);
  return {
    range,
    step,
    from: to - RANGES[range].span,
    to,
    t: points.map((p) => p.t),
    cpu: column('c'),
    mem: column('m'),
    rx: column('r'),
    tx: column('x'),
    disks: Object.entries(sizes).map(([diskPath, size]) => ({
      path: diskPath,
      name: names[diskPath] || diskPath,
      size,
      used: points.map((p) => (isNum(p.d?.[diskPath]) ? p.d[diskPath] * MIB : null)),
      fillDays: estimateFill(weekPoints, diskPath, size),
    })),
  };
}

function averaged(bucket) {
  const avg = ([sum, n]) => round1(sum / n);
  const point = { t: bucket.t };
  for (const [k, v] of Object.entries(bucket.s)) point[k] = avg(v);
  const disks = Object.entries(bucket.d);
  if (disks.length) point.d = Object.fromEntries(disks.map(([k, [sum, n]]) => [k, Math.round(sum / n)]));
  return point;
}

const addTo = (group, key, value) => {
  const entry = (group[key] ||= [0, 0]);
  entry[0] += value;
  entry[1]++;
};

function createHistory(file = FILE) {
  const sources = new Map();
  const saved = readJsonFile(file);
  if (saved && typeof saved === 'object') {
    for (const [id, s] of Object.entries(saved)) {
      if (Array.isArray(s?.day) && Array.isArray(s?.week)) sources.set(id, { open: {}, sizes: {}, ...s });
    }
  }

  // Débits : écart entre deux relevés des compteurs de la machine. Un compteur qui repart de zéro
  // (redémarrage) ou un long silence ne donnent pas de débit.
  function rates(src, net, t) {
    if (!net) return {};
    const prev = src.net;
    src.net = { t, rx: net.rx, tx: net.tx };
    if (!prev || t <= prev.t || t - prev.t > MAX_NET_GAP_S || net.rx < prev.rx || net.tx < prev.tx) return {};
    return { r: (net.rx - prev.rx) / (t - prev.t), x: (net.tx - prev.tx) / (t - prev.t) };
  }

  // sample : { cpu, mem (en %), disks: [{ path, used, size }], net: { rx, tx } } ; tout est facultatif.
  function add(id, sample, now = Date.now()) {
    if (!sources.has(id)) sources.set(id, { day: [], week: [], open: {}, sizes: {} });
    const src = sources.get(id);
    const t = Math.floor(now / 1000);
    const values = { c: sample.cpu, m: sample.mem, ...rates(src, sample.net, t) };
    if (sample.disks) src.sizes = Object.fromEntries(sample.disks.map((d) => [d.path, d.size]));
    for (const [range, { step, span }] of Object.entries(RANGES)) {
      const start = t - (t % step);
      if (src.open[range] && src.open[range].t !== start) {
        src[range].push(averaged(src.open[range]));
        src.open[range] = null;
        src[range] = src[range].filter((p) => p.t >= t - span);
      }
      const open = (src.open[range] ||= { t: start, s: {}, d: {} });
      for (const [k, v] of Object.entries(values)) if (isNum(v)) addTo(open.s, k, v);
      for (const d of sample.disks || []) if (isNum(d.used)) addTo(open.d, d.path, d.used / MIB);
    }
  }

  // Le point en cours compte aussi : la courbe va jusqu'à maintenant.
  function pointsOf(src, range, now) {
    const from = Math.floor(now / 1000) - RANGES[range].span;
    const open = src.open[range];
    return [...src[range], ...(open ? [averaged(open)] : [])].filter((p) => p.t >= from);
  }

  function read(id, range, { names, now = Date.now() } = {}) {
    const src = sources.get(id);
    if (!src) return buildSeries([], { range, step: RANGES[range].step, now });
    return buildSeries(pointsOf(src, range, now), {
      range, step: RANGES[range].step, sizes: src.sizes, names, now, weekPoints: pointsOf(src, 'week', now),
    });
  }

  // Une machine sans point depuis une semaine (widget supprimé, agent arrêté) est oubliée.
  function save(now = Date.now()) {
    for (const [id, src] of sources) {
      if (!pointsOf(src, 'week', now).length) sources.delete(id);
    }
    return writeJsonFileSync(file, Object.fromEntries(sources));
  }

  // Relevés de la machine du dashboard, écriture régulière, et dernière écriture à l'arrêt du service.
  function start(sampleLocal) {
    const sample = () => sampleLocal().catch((e) => console.warn(`[!] Relevé de l'historique impossible : ${e.message}`));
    setTimeout(sample, FIRST_SAMPLE_MS).unref();
    setInterval(sample, SAMPLE_EVERY_MS).unref();
    setInterval(save, SAVE_EVERY_MS).unref();
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.once(signal, () => {
        save();
        process.exit(0);
      });
    }
  }

  return { add, read, save, start };
}

module.exports = { RANGES, MIB, createHistory, buildSeries, estimateFill, history: createHistory() };
