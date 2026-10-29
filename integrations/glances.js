// Glances : supervision d'une autre machine (PC, Raspberry Pi, NAS, 2e serveur…), un widget par machine.
// Glances doit tourner en mode web (`glances -w`, port 61208). API v4 (Glances 4) ou v3, détectée au
// premier appel. Mot de passe facultatif (`glances -w --password` : HTTP Basic, utilisateur
// « glances » par défaut).

const { request, fail, join } = require('./lib');

const versions = new Map(); // id du widget -> '4' ou '3'

async function glancesGet(w, version, plugin) {
  const headers = { Accept: 'application/json' };
  if (w.password) headers.Authorization = `Basic ${Buffer.from(`${w.username || 'glances'}:${w.password}`).toString('base64')}`;
  const r = await request(join(w.url, `/api/${version}/${plugin}`), { headers });
  if (r.status === 401 || r.status === 403) throw fail('glances_credentials', 'Identifiants Glances refusés');
  if (r.status === 404) return undefined; // autre version de l'API, ou plugin désactivé (ex. sensors)
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

async function glancesVersion(w) {
  if (versions.has(w.id)) return versions.get(w.id);
  for (const version of ['4', '3']) {
    if ((await glancesGet(w, version, 'system')) !== undefined) {
      versions.set(w.id, version);
      return version;
    }
  }
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
  try {
    return await glancesData(w);
  } catch (e) {
    if (OFFLINE.has(e.key)) throw fail('glances_offline', 'Machine injoignable', { url: w.url });
    throw e;
  }
}

async function glancesData(w) {
  const version = await glancesVersion(w);
  const get = (plugin) => glancesGet(w, version, plugin);
  const [system, quicklook, mem, load, fs, sensors, uptime] = await Promise.all(
    ['system', 'quicklook', 'mem', 'load', 'fs', 'sensors', 'uptime'].map(get));
  const seen = new Set();
  const disks = (Array.isArray(fs) ? fs : [])
    .filter((d) => d.size > 0 && !SKIP_FS.has(d.fs_type) && !seen.has(d.device_name) && seen.add(d.device_name))
    .sort((a, b) => a.mnt_point.length - b.mnt_point.length)
    .slice(0, 4)
    .map((d) => ({ mount: d.mnt_point, used: d.used, size: d.size }));
  const temps = (Array.isArray(sensors) ? sensors : [])
    .filter((s) => typeof s.value === 'number' && (s.type === 'temperature_core' || s.unit === 'C'));
  const hottest = temps.sort((a, b) => b.value - a.value)[0];
  return {
    version,
    hostname: system?.hostname || '',
    os: system?.hr_name || [system?.os_name, system?.os_version].filter(Boolean).join(' '),
    uptime: uptimeSeconds(uptime),
    cpu: quicklook?.cpu ?? null,
    cpuName: quicklook?.cpu_name || '',
    load: load ? { min1: load.min1, cores: load.cpucore ?? null } : null,
    mem: mem ? { used: mem.used, total: mem.total } : null,
    disks,
    temp: hottest ? { value: hottest.value, label: hottest.label } : null,
  };
}

module.exports = {
  glances: { fields: ['url', 'username', 'password'], fetch: glances, reset: () => versions.clear() },
};
