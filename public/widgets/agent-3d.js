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

// Pavé droit posé sur la carte : x, y et z en pixels, w x d au sol, h de hauteur.
function cuboid({ x, y, z = 0, w, d, h: height, color, cls = '', top }) {
  const face = (name, style) => h('div', { class: `b3d-face ${name}`, style });
  return h('div', { class: `b3d ${cls}`, style: `left:${x}px;top:${y}px;width:${w}px;height:${d}px;--c:${color};transform:translateZ(${z}px)` },
    face('bottom', `width:${w}px;height:${d}px`),
    face('side', `width:${w}px;height:${height}px;transform:rotateX(90deg)`),
    face('side front', `width:${w}px;height:${height}px;transform:translateY(${d}px) rotateX(90deg)`),
    face('end', `width:${height}px;height:${d}px;transform:rotateY(-90deg)`),
    face('end', `width:${height}px;height:${d}px;transform:translateX(${w}px) rotateY(-90deg)`),
    h('div', { class: 'b3d-top', style: `width:${w}px;height:${d}px;transform:translateZ(${height}px)` }, top));
}

function boardParts() {
  const led = (cls, x, y) => h('i', { class: `b3d-led ${cls}`, style: `left:${x}px;top:${y}px` });
  const hole = (x, y) => h('i', { class: 'b3d-hole', style: `left:${x}px;top:${y}px` });
  const soc = cuboid({ x: 88, y: 70, z: 6, w: 56, d: 56, h: 5, color: '#c8ccd2', cls: 'b3d-soc', top: h('span', {}, 'SoC') });
  const ram = cuboid({ x: 156, y: 78, z: 6, w: 42, d: 42, h: 3, color: '#20242b', top: h('span', {}, 'RAM') });
  // Le point d'attache de la carte SD est sur sa partie visible, qui dépasse de la carte.
  const sd = cuboid({ x: -26, y: 92, z: -5, w: 60, d: 44, h: 4, color: '#2c4f8f', cls: 'b3d-sd', top: h('i', { class: 'b3d-anchor' }) });
  const eth = cuboid({
    x: 266, y: 148, z: 6, w: 80, d: 62, h: 52, color: '#b9bec6',
    top: [led('b3d-eth-a', 66, 8), led('b3d-eth-b', 66, 46)],
  });
  const parts = [
    cuboid({ x: 0, y: 0, w: BOARD_W, d: BOARD_D, h: 6, color: '#0f6b3c', cls: 'b3d-pcb', top: [
      hole(10, 10), hole(BOARD_W - 22, 10), hole(10, BOARD_D - 22), hole(BOARD_W - 22, BOARD_D - 22),
      h('i', { class: 'b3d-heat' }),
      led('b3d-pwr', 10, 168), led('b3d-act', 22, 168),
    ] }),
    sd,
    cuboid({ x: 28, y: 6, z: 6, w: 204, d: 20, h: 16, color: '#23262c', cls: 'b3d-gpio' }),
    soc,
    ram,
    cuboid({ x: 16, y: 58, z: 6, w: 50, d: 42, h: 5, color: '#aeb3ba', cls: 'b3d-can' }), // Wi-Fi
    cuboid({ x: 214, y: 92, z: 6, w: 36, d: 36, h: 3, color: '#20242b' }), // contrôleur réseau
    cuboid({ x: 272, y: 12, z: 6, w: 74, d: 56, h: 62, color: '#c3c8cf', cls: 'b3d-usb' }),
    cuboid({ x: 272, y: 78, z: 6, w: 74, d: 56, h: 62, color: '#c3c8cf', cls: 'b3d-usb' }),
    eth,
    cuboid({ x: 28, y: 198, z: 6, w: 30, d: 28, h: 12, color: '#c3c8cf' }), // alimentation
    cuboid({ x: 94, y: 194, z: 6, w: 60, d: 32, h: 24, color: '#c3c8cf' }), // HDMI
    cuboid({ x: 190, y: 190, z: 6, w: 28, d: 36, h: 24, color: '#17191d' }), // jack
    cuboid({ x: 166, y: 168, z: 6, w: 44, d: 12, h: 9, color: '#e7e4da' }), // caméra
    cuboid({ x: 8, y: 106, z: 6, w: 12, d: 50, h: 9, color: '#e7e4da' }), // écran
  ];
  return { parts, anchors: { soc, ram, sd, eth } };
}

// Une valeur reliée à son composant.
function boardLabel(side, key) {
  const value = h('b', {});
  const sub = h('small', { class: 'muted' });
  const bar = h('div', { class: 'b3d-label-bar' });
  const el = h('div', { class: `b3d-label b3d-${side}` },
    h('span', { class: 'muted' }, key), value, bar, sub);
  return {
    el,
    set(text, detail, ratio) {
      value.textContent = text;
      sub.textContent = detail || '';
      bar.replaceChildren(...(ratio == null ? [] : [progressBar(ratio, levelOf(ratio))]));
    },
  };
}

function createBoard() {
  const { parts, anchors } = boardParts();
  const scene = h('div', { class: 'b3d-scene' }, parts);
  const lines = svgEl('svg', { class: 'b3d-lines', 'aria-hidden': 'true' });
  const labels = {
    soc: boardLabel('left', t('stat.cpu')),
    ram: boardLabel('left', t('stat.memory')),
    eth: boardLabel('right', t('history.network')),
    sd: boardLabel('right', t('agent3d.sd')),
  };
  const wires = Object.fromEntries(Object.keys(labels).map((k) => {
    const line = svgEl('line', { class: 'b3d-wire' });
    const dot = svgEl('circle', { class: 'b3d-dot', r: '3' });
    lines.append(line, dot);
    return [k, { line, dot }];
  }));
  const stage = h('div', { class: 'b3d-stage', role: 'img', title: t('agent3d.hint') }, h('div', { class: 'b3d-view' }, scene));
  const root = h('div', { class: 'b3d-root' },
    h('div', { class: 'b3d-labels' }, labels.soc.el, labels.ram.el),
    stage,
    h('div', { class: 'b3d-labels' }, labels.eth.el, labels.sd.el),
    lines);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const view = { rx: 56, rz: -24, drag: null, touched: reduced, started: performance.now(), running: false };

  const drawWires = () => {
    const wide = root.classList.contains('b3d-wide');
    lines.style.display = wide ? '' : 'none';
    if (!wide) return;
    const box = root.getBoundingClientRect();
    lines.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    for (const [key, { line, dot }] of Object.entries(wires)) {
      const a = (anchors[key].querySelector('.b3d-anchor') || anchors[key].querySelector('.b3d-top')).getBoundingClientRect();
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
    const room = root.classList.contains('b3d-wide') ? width - 2 * 190 : width;
    scene.style.setProperty('--b3d-scale', Math.min(1, room / 520).toFixed(3));
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
      labels.soc.set(d.cpu == null ? '–' : `${Math.round(d.cpu)} %`, temp == null ? '' : `${temp} °C`, d.cpu == null ? null : d.cpu / 100);
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
