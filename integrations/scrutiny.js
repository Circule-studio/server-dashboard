// Scrutiny : santé SMART des disques (https://github.com/AnalogJ/scrutiny), sans authentification.
// device_status : 0 = sain, bit 1 = échec SMART, bit 2 = seuils de Scrutiny dépassés.

const { join, getJson } = require('./lib');

async function scrutiny(w) {
  const r = await getJson(join(w.url, '/api/summary'));
  const disks = Object.values(r.data?.summary || {})
    .filter((s) => s.device && !s.device.archived)
    .map((s) => ({
      id: s.device.wwn || s.device.device_name,
      name: s.device.device_name || s.device.wwn,
      model: s.device.model_name || '',
      capacity: s.device.capacity || null,
      failed: (s.device.device_status || 0) !== 0,
      smartFailed: ((s.device.device_status || 0) & 1) !== 0,
      temp: s.smart?.temp ?? null,
      hours: s.smart?.power_on_hours ?? null,
    }))
    .sort((a, b) => b.failed - a.failed || a.name.localeCompare(b.name));
  return { disks, failed: disks.filter((d) => d.failed).length };
}

// Alertes (case « M'alerter ») : un disque qui passe en échec, puis redevient sain.
function alerts(d, w) {
  return d.disks.map((x) => ({ id: `${w.id}:smart:${x.id}`, name: `${w.name} · ${x.name}${x.model ? ` (${x.model})` : ''}`, url: w.url, problem: 'smart', online: !x.failed }));
}

module.exports = {
  scrutiny: { fields: ['url'], cacheMs: 60_000, fetch: scrutiny, alerts },
};
