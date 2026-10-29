// Outils communs aux faux services.
const http = require('http');

const json = (res, obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
// Date dans n jours (à l'heure h) et il y a n minutes, au format ISO.
const day = (n, h = 0) => { const d = new Date(); d.setHours(h, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString(); };
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const GB = 1024 ** 3;

module.exports = { http, json, day, ago, GB };
