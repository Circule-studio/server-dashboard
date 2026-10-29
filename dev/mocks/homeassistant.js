// Faux Home Assistant.

const { http, json, ago } = require('./lib');

const haState = (entity_id, state, attributes = {}, minutes = 30) => ({ entity_id, state, attributes, last_changed: ago(minutes) });
const HA_STATES = [
  haState('sensor.salon_temperature', '21.456', { friendly_name: 'Salon', unit_of_measurement: '°C', device_class: 'temperature' }),
  haState('sensor.consommation', '1520', { friendly_name: 'Consommation', unit_of_measurement: 'W', device_class: 'power' }, 1),
  haState('binary_sensor.porte_entree', 'on', { friendly_name: 'Porte d’entrée', device_class: 'door' }, 4),
  haState('binary_sensor.mouvement_couloir', 'off', { friendly_name: 'Couloir', device_class: 'motion' }, 12),
  haState('binary_sensor.fuite_eau', 'off', { friendly_name: 'Fuite d’eau (cuisine)', device_class: 'moisture' }, 3000),
  haState('light.salon', 'on', { friendly_name: 'Lumière du salon' }, 45),
  haState('person.thomas', 'not_home', { friendly_name: 'Thomas' }, 180),
  haState('lock.porte_garage', 'locked', { friendly_name: 'Garage' }, 600),
  haState('climate.salon', 'heat', { friendly_name: 'Thermostat' }, 90),
  haState('sensor.cave_humidite', 'unavailable', { friendly_name: 'Humidité cave' }, 20),
];
http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer ha-token') { res.writeHead(401); return res.end('401: Unauthorized'); }
  const m = req.url.match(/^\/api\/states\/([^/?]+)$/);
  const state = m && HA_STATES.find((e) => e.entity_id === decodeURIComponent(m[1]));
  if (state) return json(res, state);
  if (req.url === '/api/states') return json(res, HA_STATES);
  res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"Entity not found."}');
}).listen(18123);
