// Vue 3D d'un widget Agent : une maquette de Raspberry Pi animée par les valeurs de la machine.
// Le SoC chauffe, les voyants suivent le CPU et le réseau, et des traits relient chaque valeur à son
// composant. Du CSS 3D, sans bibliothèque. Chargé après app.js et history.js : voir CONTRIBUTING.md.

const BOARD_W = 340; // 85 x 56 mm, à 4 pixels par millimètre
const BOARD_D = 224;
const ROTATE_PER_PX = 0.4;
const SWAY_DEGREES = 20;
const SWAY_MS = 16_000;
const WIDE_STAGE_PX = 620; // en dessous : valeurs sous la maquette, sans traits
const boards = new Map(); // id du widget -> maquette : l'angle choisi survit aux rafraîchissements

// Pavé droit posé sur la carte : x, y et z en pixels, w x d au sol, h de hauteur. top, front et right :
// le contenu de ces faces. inset : côtés raccourcis, pour suivre les coins arrondis de la carte.
function cuboid({ x, y, z = 0, w, d, h: height, color, cls = '', top, front, right, inset = 0 }) {
  const face = (name, style, content) => h('div', { class: `b3d-face ${name}`, style }, content);
  return h('div', { class: `b3d ${cls}`, style: `left:${x}px;top:${y}px;width:${w}px;height:${d}px;--c:${color};transform:translateZ(${z}px)` },
    face('bottom', `width:${w}px;height:${d}px`),
    face('side', `left:${inset}px;width:${w - 2 * inset}px;height:${height}px;transform:rotateX(90deg)`),
    face('side front', `left:${inset}px;width:${w - 2 * inset}px;height:${height}px;transform:translateY(${d}px) rotateX(90deg)`, front),
    face('end', `top:${inset}px;width:${height}px;height:${d - 2 * inset}px;transform:rotateY(-90deg)`),
    face('end', `top:${inset}px;width:${height}px;height:${d - 2 * inset}px;transform:translateX(${w}px) rotateY(-90deg)`, right),
    h('div', { class: 'b3d-top', style: `width:${w}px;height:${d}px;transform:translateZ(${height}px)` }, top));
}

const place = (cls, left, top, width, height, content) => h('i', { class: cls, style: `left:${left}px;top:${top}px;width:${width}px;height:${height}px` }, content);

// Connecteur GPIO : un socle, et les 40 broches dessinées sur trois plans, bien plus léger que 40 pavés.
function gpio(x, y) {
  const pinsZ = 14;
  const plane = (py) => h('i', { class: 'b3d-pins', style: `transform:translateY(${py}px) rotateX(90deg)` });
  return h('div', { class: 'b3d', style: `left:${x}px;top:${y}px;width:204px;height:20px;transform:translateZ(6px)` },
    cuboid({ x: 0, y: 0, w: 204, d: 20, h: 7, color: '#17191d' }),
    plane(5), plane(15),
    h('i', { class: 'b3d-pin-tops', style: `transform:translateZ(${pinsZ + 6}px)` }));
}

function boardParts() {
  const led = (cls, left, top) => h('i', { class: `b3d-led ${cls}`, style: `left:${left}px;top:${top}px` });
  const hole = (left, top) => h('i', { class: 'b3d-hole', style: `left:${left}px;top:${top}px` });
  // Sur les faces, le premier axe monte depuis la carte (face de droite) ou la suit (face avant).
  const usbPorts = [place('b3d-port b3d-port-usb', 7, 9, 21, 38), place('b3d-port b3d-port-usb', 34, 9, 21, 38)];
  const soc = cuboid({ x: 88, y: 70, z: 6, w: 56, d: 56, h: 5, color: '#c8ccd2', cls: 'b3d-soc', top: h('span', {}, 'BCM2837') });
  const ram = cuboid({ x: 156, y: 78, z: 6, w: 42, d: 42, h: 3, color: '#20242b', cls: 'b3d-chip', top: h('span', {}, 'RAM') });
  // Le point d'attache de la carte SD est sur sa partie visible, qui dépasse de la carte.
  const sd = cuboid({ x: -26, y: 92, z: -5, w: 60, d: 44, h: 4, color: '#2c4f8f', cls: 'b3d-sd', top: h('i', { class: 'b3d-anchor' }) });
  const eth = cuboid({
    x: 266, y: 148, z: 6, w: 80, d: 62, h: 52, color: '#b9bec6', cls: 'b3d-metal',
    right: [place('b3d-port', 6, 10, 38, 42), led('b3d-eth-a', 40, 4), led('b3d-eth-b', 40, 54)],
  });
  // Petits composants à plat sur le circuit : une grille régulière, décalée d'une rangée à l'autre.
  const smd = [];
  for (const [ox, oy, cols, rows] of [[70, 134, 7, 3], [150, 128, 6, 3], [28, 112, 3, 6], [206, 134, 4, 4], [66, 36, 12, 2], [12, 178, 2, 2]]) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cls = (c + r) % 3 === 0 ? 'b3d-smd b3d-smd-dark' : 'b3d-smd';
        smd.push(place(cls, ox + c * 10 + (r % 2) * 3, oy + r * 8, 6, 3));
      }
    }
  }
  const caps = [[238, 136], [252, 136], [238, 152], [66, 176], [80, 176]].map(([x, y]) => cuboid({ x, y, z: 6, w: 9, d: 9, h: 11, color: '#c7ccd2', cls: 'b3d-cap' }));
  const parts = [
    h('i', { class: 'b3d-shadow' }),
    cuboid({ x: 0, y: 0, w: BOARD_W, d: BOARD_D, h: 6, color: '#0a4f2c', cls: 'b3d-pcb', inset: 10, top: [
      h('i', { class: 'b3d-traces' }),
      hole(10, 10), hole(BOARD_W - 22, 10), hole(10, BOARD_D - 22), hole(BOARD_W - 22, BOARD_D - 22),
      h('i', { class: 'b3d-heat' }),
      place('b3d-silk-box', 25, 3, 210, 26),
      h('span', { class: 'b3d-silk', style: 'left:150px;top:44px' }, 'Raspberry Pi 3 Model B+'),
      ...smd,
      led('b3d-pwr', 10, 168), led('b3d-act', 22, 168),
    ] }),
    sd,
    gpio(28, 6),
    soc,
    ram,
    cuboid({ x: 16, y: 58, z: 6, w: 50, d: 42, h: 5, color: '#aeb3ba', cls: 'b3d-can' }), // Wi-Fi
    cuboid({ x: 214, y: 92, z: 6, w: 36, d: 36, h: 3, color: '#20242b', cls: 'b3d-chip', top: h('span', {}, 'LAN') }),
    cuboid({ x: 238, y: 18, z: 6, w: 22, d: 22, h: 12, color: '#17191d', cls: 'b3d-poe' }), // PoE
    ...caps,
    cuboid({ x: 272, y: 12, z: 6, w: 74, d: 56, h: 62, color: '#c3c8cf', cls: 'b3d-usb b3d-metal', right: usbPorts }),
    cuboid({ x: 272, y: 78, z: 6, w: 74, d: 56, h: 62, color: '#c3c8cf', cls: 'b3d-usb b3d-metal', right: usbPorts.map((p) => p.cloneNode(true)) }),
    eth,
    cuboid({ x: 28, y: 198, z: 6, w: 30, d: 28, h: 12, color: '#c3c8cf', cls: 'b3d-metal', front: place('b3d-port', 6, 3, 18, 6) }), // alimentation
    cuboid({ x: 94, y: 194, z: 6, w: 60, d: 32, h: 24, color: '#c3c8cf', cls: 'b3d-metal', front: place('b3d-port b3d-port-hdmi', 7, 6, 46, 13) }), // HDMI
    cuboid({ x: 190, y: 190, z: 6, w: 28, d: 36, h: 24, color: '#17191d', front: place('b3d-port b3d-port-jack', 7, 5, 14, 14) }), // jack
    cuboid({ x: 166, y: 168, z: 6, w: 44, d: 12, h: 9, color: '#e7e4da', cls: 'b3d-ribbon' }), // caméra
    cuboid({ x: 8, y: 106, z: 6, w: 12, d: 50, h: 9, color: '#e7e4da', cls: 'b3d-ribbon' }), // écran
  ];
  return { parts, anchors: { soc, ram, sd, eth } };
}

// Icônes des anneaux, sur une grille de 24.
const BOARD_ICONS = {
  cpu: 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M8.5 7h7A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 15.5v-7A1.5 1.5 0 0 1 8.5 7z',
  memory: 'M4.5 8h15A1.5 1.5 0 0 1 21 9.5v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 14.5v-5A1.5 1.5 0 0 1 4.5 8zM7 16v3M12 16v3M17 16v3M7 11v2M12 11v2M17 11v2',
  sd: 'M7 3h8l4 4v14H5V5a2 2 0 0 1 2-2zM9 7v3M12 7v3M15 7v3',
  network: 'M8 4v14M4 14l4 4 4-4M16 20V6M12 10l4-4 4 4',
};

// Une valeur et son anneau, reliés à leur composant. Sans part à montrer (le réseau), l'anneau reste vide.
function boardLabel(side, key, icon) {
  const value = h('b', {});
  const sub = h('small', { class: 'muted' });
  const fill = svgEl('circle', { class: 'b3d-ring-fill', cx: '24', cy: '24', r: '20', pathLength: '100', 'stroke-dasharray': '0 100', transform: 'rotate(-90 24 24)' });
  const ring = svgEl('svg', { class: 'b3d-ring', viewBox: '0 0 48 48', 'aria-hidden': 'true' },
    svgEl('circle', { class: 'b3d-ring-track', cx: '24', cy: '24', r: '20' }),
    fill,
    svgEl('path', { class: 'b3d-ring-icon', d: BOARD_ICONS[icon], transform: 'translate(13.2 13.2) scale(0.9)' }));
  const el = h('div', { class: `b3d-label b3d-${side}` },
    ring, h('div', { class: 'b3d-label-text' }, h('span', { class: 'muted' }, key), value, sub));
  return {
    el,
    set(text, detail, ratio) {
      value.textContent = text;
      sub.textContent = detail || '';
      fill.setAttribute('stroke-dasharray', `${ratio == null ? 0 : Math.min(100, ratio * 100).toFixed(1)} 100`);
      fill.setAttribute('class', `b3d-ring-fill ${ratio == null ? 'b3d-ring-empty' : levelOf(ratio)}`);
    },
  };
}

// Grande jauge de température : un arc de 270°, de GAUGE_MIN à GAUGE_MAX °C.
const GAUGE_MIN = 20;
const GAUGE_MAX = 90;
const GAUGE_ARC = 75; // part du cercle occupée par l'arc

function tempWord(temp) {
  if (temp < 60) return t('agent3d.cool');
  if (temp < 75) return t('agent3d.warm');
  return temp < 85 ? t('agent3d.hot') : t('agent3d.burning');
}

function boardGauge(side) {
  const arc = (cls, length) => svgEl('circle', {
    class: cls, cx: '60', cy: '60', r: '50', pathLength: '100', 'stroke-dasharray': `${length} 100`, transform: 'rotate(135 60 60)',
  });
  const fill = arc('b3d-gauge-fill', 0);
  const value = h('b', {});
  const word = h('small', {});
  const el = h('div', { class: `b3d-label b3d-gauge b3d-${side}`, title: t('agent3d.temp') },
    svgEl('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' }, arc('b3d-gauge-track', GAUGE_ARC), fill),
    h('div', { class: 'b3d-gauge-text' }, value, word));
  return {
    el,
    set(temp) {
      value.textContent = temp == null ? '–' : `${temp} °C`;
      word.textContent = temp == null ? t('agent3d.temp') : tempWord(temp);
      const ratio = temp == null ? 0 : Math.min(1, Math.max(0, (temp - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)));
      fill.setAttribute('stroke-dasharray', `${(ratio * GAUGE_ARC).toFixed(1)} 100`);
    },
  };
}

function createBoard() {
  const { parts, anchors } = boardParts();
  const scene = h('div', { class: 'b3d-scene' }, parts);
  const lines = svgEl('svg', { class: 'b3d-lines', 'aria-hidden': 'true' });
  const gauge = boardGauge('left');
  const labels = {
    temp: gauge,
    sd: boardLabel('left', t('agent3d.sd'), 'sd'),
    soc: boardLabel('right', t('stat.cpu'), 'cpu'),
    ram: boardLabel('right', t('stat.memory'), 'memory'),
    eth: boardLabel('right', t('history.network'), 'network'),
  };
  const targets = { ...anchors, temp: anchors.soc };
  const wires = Object.fromEntries(Object.keys(labels).map((k) => {
    const line = svgEl('line', { class: 'b3d-wire' });
    const dot = svgEl('circle', { class: 'b3d-dot', r: '3' });
    lines.append(line, dot);
    return [k, { line, dot }];
  }));
  const stage = h('div', { class: 'b3d-stage', role: 'img', title: t('agent3d.hint') }, h('div', { class: 'b3d-view' }, scene));
  const root = h('div', { class: 'b3d-root' },
    h('div', { class: 'b3d-labels b3d-labels-left' }, labels.temp.el, labels.sd.el),
    stage,
    h('div', { class: 'b3d-labels' }, labels.soc.el, labels.ram.el, labels.eth.el),
    lines);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const view = { rx: 54, rz: 32, drag: null, touched: reduced, started: performance.now(), running: false };

  const drawWires = () => {
    const wide = root.classList.contains('b3d-wide');
    lines.style.display = wide ? '' : 'none';
    if (!wide) return;
    const box = root.getBoundingClientRect();
    lines.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    for (const [key, { line, dot }] of Object.entries(wires)) {
      const a = (targets[key].querySelector('.b3d-anchor') || targets[key].querySelector('.b3d-top')).getBoundingClientRect();
      const l = labels[key].el.getBoundingClientRect();
      const left = labels[key].el.classList.contains('b3d-left');
      const x1 = (left ? l.right : l.left) - box.left;
      const y1 = l.top + l.height / 2 - box.top;
      const x2 = a.left + a.width / 2 - box.left;
      const y2 = a.top + a.height / 2 - box.top;
      for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) line.setAttribute(k, v.toFixed(1));
      dot.setAttribute('cx', x2.toFixed(1));
      dot.setAttribute('cy', y2.toFixed(1));
    }
  };

  const applyLayout = () => {
    const width = root.clientWidth;
    root.classList.toggle('b3d-wide', width >= WIDE_STAGE_PX);
    const room = root.classList.contains('b3d-wide') ? width - 2 * 230 : width;
    scene.style.setProperty('--b3d-scale', Math.min(1.3, room / 470).toFixed(3));
  };

  const frame = (now) => {
    if (!root.isConnected || document.hidden) {
      view.running = false;
      return;
    }
    const sway = view.touched ? 0 : Math.sin(((now - view.started) / SWAY_MS) * 2 * Math.PI) * SWAY_DEGREES;
    scene.style.transform = `scale(var(--b3d-scale, 1)) rotateX(${view.rx}deg) rotateZ(${view.rz + sway}deg)`;
    drawWires();
    requestAnimationFrame(frame);
  };
  const start = () => {
    applyLayout();
    if (view.running) return;
    view.running = true;
    requestAnimationFrame(frame);
  };

  // Glisser pour tourner. Les écouteurs restent sur la fenêtre : la maquette peut être déplacée entre-temps.
  stage.addEventListener('pointerdown', (e) => {
    view.drag = { x: e.clientX, y: e.clientY };
    view.touched = true;
    stage.classList.add('b3d-grabbing');
  });
  window.addEventListener('pointermove', (e) => {
    if (!view.drag) return;
    view.rz += (e.clientX - view.drag.x) * ROTATE_PER_PX;
    view.rx = Math.min(78, Math.max(8, view.rx - (e.clientY - view.drag.y) * ROTATE_PER_PX));
    view.drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', () => {
    view.drag = null;
    stage.classList.remove('b3d-grabbing');
  });
  new ResizeObserver(applyLayout).observe(root);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && root.isConnected) start(); });

  return {
    root,
    update(d) {
      root.classList.toggle('b3d-offline', !!d.offline);
      const temp = d.temp ? Math.round(d.temp.value) : null;
      // Du vert au rouge entre 40 et 85 °C.
      const heat = temp == null ? 0 : Math.min(1, Math.max(0, (temp - 40) / 45));
      root.style.setProperty('--b3d-heat', heat.toFixed(2));
      root.style.setProperty('--b3d-soc', `hsl(${Math.round(130 - heat * 130)} 70% 45%)`);
      // Voyants : plus le CPU ou le réseau travaillent, plus ils clignotent vite.
      root.style.setProperty('--b3d-act', `${(1.8 - Math.min(100, d.cpu ?? 0) * 0.016).toFixed(2)}s`);
      const flow = (d.rate?.rx ?? 0) + (d.rate?.tx ?? 0);
      root.style.setProperty('--b3d-net', `${flow > 1e6 ? 0.2 : flow > 1e4 ? 0.6 : 1.6}s`);
      gauge.set(temp);
      labels.soc.set(d.cpu == null ? '–' : `${Math.round(d.cpu)} %`, d.load ? t('agent3d.load', { load: d.load.min1.toLocaleString(LOCALE, { maximumFractionDigits: 2 }) }) : '', d.cpu == null ? null : d.cpu / 100);
      labels.ram.set(d.mem ? `${Math.round((d.mem.used / d.mem.total) * 100)} %` : '–', d.mem ? `${fmtBytes(d.mem.used)} / ${fmtBytes(d.mem.total)}` : '', d.mem ? d.mem.used / d.mem.total : null);
      const disk = d.disks?.[0];
      labels.sd.set(disk ? `${Math.round((disk.used / disk.size) * 100)} %` : '–', disk ? `${fmtBytes(disk.used)} / ${fmtBytes(disk.size)}` : '', disk ? disk.used / disk.size : null);
      labels.eth.set(d.rate ? `↓ ${fmtRate(d.rate.rx ?? 0)}` : '–', d.rate ? `↑ ${fmtRate(d.rate.tx ?? 0)}` : t('agent3d.noNet'), null);
      stage.setAttribute('aria-label', t('agent3d.summary', { name: d.hostname || '', cpu: d.cpu == null ? '–' : Math.round(d.cpu), temp: temp ?? '–' }));
    },
    start,
  };
}

// Contenu du widget Agent avec l'option « Vue 3D ».
function agentBoard(d, w) {
  if (!boards.has(w.id)) boards.set(w.id, createBoard());
  const board = boards.get(w.id);
  board.update(d);
  queueMicrotask(board.start);
  return [
    d.offline ? h('p', { class: 'agent-offline' }, h('span', { class: 'dot bad' }), ` ${t('agent.offline', { duration: fmtAgo(d.seen) })}`) : null,
    h('div', { class: 'row glances-head' },
      h('span', { class: 'item-title', title: d.os }, h('span', { class: `dot ${d.offline ? 'bad' : 'ok'}` }), ` ${d.hostname}`),
      h('span', { class: 'muted' }, d.uptime != null && !d.offline ? t('glances.onlineFor', { duration: fmtUptime(d.uptime) }) : '')),
    board.root,
  ];
}
