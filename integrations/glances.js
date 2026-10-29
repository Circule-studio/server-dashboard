// Glances : supervision d'une autre machine (PC, Raspberry Pi, NAS, 2e serveur…), un widget par machine.
// Glances doit tourner en mode web (`glances -w`, port 61208). API v4 (Glances 4) ou v3, détectée au
// premier appel. Mot de passe facultatif (`glances -w --password` : HTTP Basic, utilisateur
// « glances » par défaut).

const { request, fail, join, basicAuth, diskAlerts } = require('./lib');

const versions = new Map(); // id du widget -> '4' ou '3'
// Machine éteinte : retenue OFFLINE_RETRY_MS, pour ne pas la sonder à chaque rafraîchissement de
// chaque visiteur (une machine éteinte peut faire attendre chaque connexion jusqu'au délai maximal).
const OFFLINE_RETRY_MS = 30_000;
const offline = new Map(); // id du widget -> { until, error }

async function glancesGet(w, version, plugin) {
  const headers = { Accept: 'application/json', ...(w.password ? basicAuth(w.username || 'glances', w.password) : {}) };
  const r = await request(join(w.url, `/api/${version}/${plugin}`), { headers });
  if (r.status === 401 || r.status === 403) throw fail('glances_credentials', 'Identifiants Glances refusés');
  if (r.status === 404) return undefined; // autre version de l'API, ou plugin désactivé (ex. sensors)
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

// Version de l'API et plugin system (il sert aussi à la détection). La version retenue est
// revérifiée si system y répond 404 : Glances mis à jour, ou autre machine à la même adresse.
async function glancesSystem(w) {
  const known = versions.get(w.id);
  for (const version of known ? [known, ...['4', '3'].filter((v) => v !== known)] : ['4', '3']) {
    const system = await glancesGet(w, version, 'system');
    if (system !== undefined) {
      versions.set(w.id, version);
      return { version, system };
    }
  }
  versions.delete(w.id);
  throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
}

// « 3 days, 4:05:06 » ou « 4:05:06 » -> secondes.
function uptimeSeconds(text) {
  const m = typeof text === 'string' && text.match(/(?:(\d+) days?, )?(\d+):(\d+):(\d+)/);
  return m ? (Number(m[1] || 0) * 86400) + (Number(m[2]) * 3600) + (Number(m[3]) * 60) + Number(m[4]) : null;
}

// Systèmes de fichiers sans intérêt (images snap, couches Docker, mémoire).
const SKIP_FS = new Set(['squashfs', 'overlay', 'tmpfs', 'devtmpfs', 'iso9660']);

// Machine éteinte ou hors du réseau : un message qui parle de la machine, pas d'un « service ».
const OFFLINE = new Set(['unreachable', 'host_unreachable', 'host_not_found', 'timeout', 'connection_reset']);

async function glances(w) {
  const down = offline.get(w.id);
  if (down?.until > Date.now()) throw down.error;
  try {
    return await glancesData(w);
  } catch (e) {
    if (!OFFLINE.has(e.key)) throw e;
    const error = fail('glances_offline', 'Machine injoignable', { url: w.url });
    offline.set(w.id, { until: Date.now() + OFFLINE_RETRY_MS, error });
    throw error;
  }
}

// Disques : un par périphérique, sous son point de montage le plus court (« / » plutôt qu'un
// sous-dossier monté du même disque, comme /etc/hosts quand Glances tourne dans Docker).
function glancesDisks(fs) {
  const byDevice = new Map();
  for (const d of Array.isArray(fs) ? fs : []) {
    if (!(d.size > 0) || SKIP_FS.has(d.fs_type)) continue;
    const prev = byDevice.get(d.device_name);
    if (!prev || d.mnt_point.length < prev.mnt_point.length) byDevice.set(d.device_name, d);
  }
  return [...byDevice.values()]
    .sort((a, b) => a.mnt_point.length - b.mnt_point.length || a.mnt_point.localeCompare(b.mnt_point))
    .slice(0, 4)
    .map((d) => ({ mount: d.mnt_point, used: d.used, size: d.size }));
}

// Température la plus haute, en °C (Glances lancé avec --fahrenheit donne des °F).
function glancesTemp(sensors) {
  const temps = (Array.isArray(sensors) ? sensors : [])
    .filter((s) => typeof s.value === 'number' && (s.unit === 'C' || s.unit === 'F'))
    .map((s) => ({ label: s.label, value: s.unit === 'F' ? Math.round(((s.value - 32) * 5) / 9) : s.value }));
  return temps.sort((a, b) => b.value - a.value)[0] || null;
}

async function glancesData(w) {
  const { version, system } = await glancesSystem(w);
  const [quicklook, mem, load, fs, sensors, uptime] = await Promise.all(
    ['quicklook', 'mem', 'load', 'fs', 'sensors', 'uptime'].map((plugin) => glancesGet(w, version, plugin)));
  return {
    version,
    hostname: system?.hostname || '',
    os: system?.hr_name || [system?.os_name, system?.os_version].filter(Boolean).join(' '),
    uptime: uptimeSeconds(uptime),
    cpu: quicklook?.cpu ?? null,
    cpuName: quicklook?.cpu_name || '',
    load: typeof load?.min1 === 'number' ? { min1: load.min1, cores: load.cpucore ?? null } : null,
    mem: mem?.total ? { used: mem.used, total: mem.total } : null,
    disks: glancesDisks(fs),
    temp: glancesTemp(sensors),
  };
}

// Alertes : la machine (hors ligne quand Glances ne répond plus, voir offlineCodes) et ses disques.
const alerts = (d, w) => [{ id: `${w.id}:machine`, name: w.name, url: w.url, online: true }, ...diskAlerts(w, d.disks)];

module.exports = {
  glances: {
    fields: ['url', 'username', 'password'], fetch: glances, alerts, offlineCodes: ['glances_offline'],
    reset: () => { versions.clear(); offline.clear(); },
  },
};
