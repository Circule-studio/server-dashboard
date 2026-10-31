// Faux Scrutiny (sans clé) : trois disques, dont un en échec SMART et un archivé (ignoré).

const { http, json } = require('./lib');

const disk = (wwn, name, model, capacity, status, temp, hours, archived = false) => ({
  device: { wwn, device_name: name, model_name: model, capacity, device_status: status, archived },
  smart: { collector_date: new Date().toISOString(), temp, power_on_hours: hours },
});

http.createServer((req, res) => {
  if (req.url !== '/api/summary') { res.writeHead(404); return res.end(); }
  json(res, { success: true, data: { summary: {
    '0x5000c500a1b2c3d4': disk('0x5000c500a1b2c3d4', 'sda', 'Samsung SSD 870 EVO 1TB', 1e12, 0, 34, 12450),
    '0x5000cca2b3c4d5e6': disk('0x5000cca2b3c4d5e6', 'sdb', 'WDC WD40EFRX-68N32N0', 4e12, 1, 57, 41230),
    '0x50014ee2c3d4e5f6': disk('0x50014ee2c3d4e5f6', 'sdc', 'ST2000DM008', 2e12, 0, 38, 8800),
    '0x50014ee2ffffffff': disk('0x50014ee2ffffffff', 'sdz', 'Ancien disque', 5e11, 3, 0, 0, true),
  } } });
}).listen(18580);
