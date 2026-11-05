// Ressources de la machine du dashboard (CPU, mémoire, disques) et API Docker Engine.

const fsp = require('fs/promises');
const os = require('os');
const http = require('http');

const DISK_PATH = process.env.DISK_PATH || (process.platform === 'win32' ? 'C:\\' : '/');
const DOCKER_SOCKET = process.env.DOCKER_SOCKET ||
  (process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock');

let lastCpu = os.cpus();

function cpuUsage() {
  const now = os.cpus();
  let idle = 0, total = 0;
  now.forEach((c, i) => {
    const prev = lastCpu[i] ? lastCpu[i].times : { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const t = c.times;
    idle += t.idle - prev.idle;
    total += (t.user - prev.user) + (t.nice - prev.nice) + (t.sys - prev.sys) + (t.idle - prev.idle) + (t.irq - prev.irq);
  });
  lastCpu = now;
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

async function memInfo() {
  // Sous Linux, MemAvailable est plus juste que os.freemem() (qui ignore le cache).
  if (process.platform === 'linux') {
    try {
      const txt = await fsp.readFile('/proc/meminfo', 'utf8');
      const get = (k) => Number((txt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1]) * 1024;
      const total = get('MemTotal'), avail = get('MemAvailable');
      if (total && avail) return { total, used: total - avail };
    } catch { /* repli sur os */ }
  }
  return { total: os.totalmem(), used: os.totalmem() - os.freemem() };
}

// ---------- Disques ----------
// Systèmes de fichiers « réels » sous Linux (on ignore proc, tmpfs, overlay, cgroup…).
const LINUX_FS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'f2fs', 'jfs', 'ntfs', 'ntfs3', 'fuseblk',
  'vfat', 'exfat', 'nfs', 'nfs4', 'cifs', 'smb3', 'fuse.mergerfs', 'fuse.shfs']);
const SKIP_MOUNTS = /^\/(proc|sys|dev|run|snap|boot\/efi|var\/lib\/docker)(\/|$)/;

async function statDisk(diskPath) {
  const s = await fsp.statfs(diskPath);
  const total = s.blocks * s.bsize;
  return { total, used: total - s.bavail * s.bsize };
}

async function diskInfo(d) {
  try {
    return { ...d, ...(await statDisk(d.path)) };
  } catch (e) {
    return { ...d, error: e.code === 'ENOENT' ? 'Chemin introuvable' : e.message, errorCode: e.code === 'ENOENT' ? 'path_not_found' : undefined };
  }
}

// Disques affichés : ceux choisis en mode édition, sinon DISK_PATH.
const disksOf = (cfg) => (cfg.disks?.length ? cfg.disks : [{ path: DISK_PATH, label: '' }]);

// Disques présents sur la machine, proposés dans le mode édition.
async function detectDisks() {
  if (process.platform === 'win32') {
    const found = [];
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const diskPath = `${letter}:\\`;
      try { found.push({ path: diskPath, ...(await statDisk(diskPath)) }); } catch { /* lecteur absent */ }
    }
    return found.filter((d) => d.total > 0);
  }
  let mounts;
  try {
    mounts = await fsp.readFile('/proc/mounts', 'utf8');
  } catch {
    return [await diskInfo({ path: '/' })];
  }
  // Un même périphérique peut être monté plusieurs fois : on garde DISK_PATH, sinon le chemin le plus court.
  const byDevice = new Map();
  for (const line of mounts.split('\n')) {
    const [device, rawPath, type] = line.split(' ');
    if (!rawPath || !LINUX_FS.has(type)) continue;
    const diskPath = rawPath.replace(/\\040/g, ' ');
    if (SKIP_MOUNTS.test(diskPath)) continue;
    const prev = byDevice.get(device);
    if (prev && (prev.path === DISK_PATH || (diskPath !== DISK_PATH && prev.path.length <= diskPath.length))) continue;
    byDevice.set(device, { path: diskPath, type });
  }
  const found = await Promise.all([...byDevice.values()].map(diskInfo));
  return found.filter((d) => !d.error && d.total > 0).sort((a, b) => a.path.localeCompare(b.path));
}

// ---------- Docker (API Engine via socket unix / named pipe) ----------
// Comme request() dans integrations/lib.js : taille et durée totale bornées, une seule issue.
const DOCKER_MAX_BYTES = 20 * 1024 * 1024;

function docker(method, apiPath) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const req = http.request({ socketPath: DOCKER_SOCKET, path: apiPath, method, timeout: 5000 }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('error', (e) => finish(reject, e));
      res.on('data', (d) => {
        size += d.length;
        if (size > DOCKER_MAX_BYTES) {
          finish(reject, new Error('Docker : réponse trop volumineuse'));
          req.destroy();
          return;
        }
        chunks.push(d);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) return finish(reject, new Error(`Docker ${res.statusCode}: ${body.slice(0, 500)}`));
        let data = null;
        try { data = body ? JSON.parse(body) : null; } catch { /* pas du JSON */ }
        finish(resolve, data);
      });
    });
    timer = setTimeout(() => req.destroy(new Error('timeout')), 15_000);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => finish(reject, e));
    req.end();
  });
}

// CPU et mémoire de conteneurs Docker, par nom. CPU : part de la machine entière (comme pour
// une VM Proxmox, part de ses cœurs). stream=false : Docker attend une seconde mesure (~1 s).
async function dockerUsage(names) {
  const list = await docker('GET', '/containers/json?all=1');
  const out = {};
  await Promise.all([...new Set(names)].map(async (name) => {
    const c = list.find((x) => (x.Names || []).some((n) => n.replace(/^\//, '') === name));
    if (!c) return;
    const base = { name: `Docker · ${name}`, running: c.State === 'running' };
    out[name] = base;
    if (!base.running) return;
    try {
      const s = await docker('GET', `/containers/${c.Id}/stats?stream=false`);
      const cpu = (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
      const system = (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
      const m = s.memory_stats || {};
      // Comme `docker stats` : le cache de fichiers inactif ne compte pas.
      const used = (m.usage || 0) - (m.stats?.inactive_file ?? m.stats?.total_inactive_file ?? 0);
      out[name] = { ...base, cpu: system > 0 && cpu > 0 ? Math.min(1, cpu / system) : 0, mem: m.limit ? Math.max(0, used) / m.limit : 0 };
    } catch { /* conteneur arrêté entre-temps : état seul */ }
  }));
  return out;
}

module.exports = { cpuUsage, memInfo, diskInfo, disksOf, detectDisks, docker, dockerUsage };
