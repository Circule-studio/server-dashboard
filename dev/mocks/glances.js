// Faux Glances : deux machines, pour tester les deux versions de l'API.
//   61208 : PC de bureau, API v4, sans mot de passe
//   61209 : Raspberry Pi, API v3, mot de passe glances / glances-pass, presque saturé

const { http, json, GB } = require('./lib');

function glancesServer(port, version, { auth, data }) {
  http.createServer((req, res) => {
    if (auth && req.headers.authorization !== `Basic ${Buffer.from(auth).toString('base64')}`) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Glances"' }); return res.end();
    }
    const m = req.url.match(new RegExp(`^/api/${version}/(\\w+)$`));
    if (m && m[1] in data) return json(res, data[m[1]]);
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"detail":"Not Found"}');
  }).listen(port);
}

glancesServer(61208, 4, { data: {
  system: { hostname: 'pc-bureau', os_name: 'Windows', os_version: '11', hr_name: 'Windows 11 Pro', platform: '64bit' },
  quicklook: { cpu: 23.4, mem: 28.5, swap: 3.1, cpu_name: 'AMD Ryzen 7 7700X' },
  mem: { total: 32 * GB, used: 9.1 * GB, percent: 28.5 },
  load: { min1: 1.42, min5: 1.1, min15: 0.9, cpucore: 16 },
  fs: [
    { device_name: 'C:\\', fs_type: 'NTFS', mnt_point: 'C:\\', size: 953 * GB, used: 412 * GB, percent: 43.2 },
    { device_name: 'D:\\', fs_type: 'NTFS', mnt_point: 'D:\\', size: 1863 * GB, used: 1544 * GB, percent: 82.9 },
  ],
  sensors: [{ label: 'Tctl', value: 61, unit: 'C', type: 'temperature_core' }, { label: 'fan1', value: 900, unit: 'R', type: 'fan_speed' }],
  uptime: '3 days, 4:05:06',
} });

glancesServer(61209, 3, { auth: 'glances:glances-pass', data: {
  system: { hostname: 'raspberrypi', os_name: 'Linux', os_version: '6.6.51', hr_name: 'Debian GNU/Linux 12 64bit', platform: '64bit' },
  quicklook: { cpu: 88.2, mem: 91.3, swap: 40, cpu_name: 'Cortex-A76' },
  mem: { total: 4 * GB, used: 3.65 * GB, percent: 91.3 },
  load: { min1: 3.7, min5: 3.2, min15: 2.9, cpucore: 4 },
  fs: [
    { device_name: '/dev/mmcblk0p2', fs_type: 'ext4', mnt_point: '/', size: 58 * GB, used: 27 * GB, percent: 46.5 },
    { device_name: '/dev/mmcblk0p2', fs_type: 'ext4', mnt_point: '/var/log', size: 58 * GB, used: 27 * GB, percent: 46.5 },
    { device_name: '/dev/loop0', fs_type: 'squashfs', mnt_point: '/snap/core', size: 0.1 * GB, used: 0.1 * GB, percent: 100 },
  ],
  // sensors absent : plugin désactivé (404), le widget s'en passe.
  uptime: '17:42:10',
} });
