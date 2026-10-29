#!/usr/bin/env node
// Agent Server Dashboard : envoie les ressources de cette machine (CPU, mémoire, disques, température,
// uptime) au dashboard, toutes les AGENT_INTERVAL secondes. C'est la machine qui contacte le dashboard :
// rien à ouvrir sur son pare-feu, ça marche derrière un NAT. Node.js 18 ou plus récent, sans dépendance.
//
//   DASHBOARD_URL=http://192.168.1.10:7575 AGENT_ID=wid-… AGENT_TOKEN=… node server-dashboard-agent.js
//
// La commande exacte (identifiant et jeton compris) est donnée par le dashboard : mode édition, widget
// « Agent ». Variables facultatives :
//   AGENT_INTERVAL  secondes entre deux envois (30 par défaut, 5 au minimum)
//   AGENT_DISKS     disques à surveiller, séparés par des virgules (« / » ou « C:\ » par défaut)
//   --once          un seul envoi, puis arrêt (pour tester)

const fs = require('fs');
const os = require('os');

const URL_BASE = (process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
const ID = process.env.AGENT_ID || '';
const TOKEN = process.env.AGENT_TOKEN || '';
const INTERVAL = Math.max(5, Number(process.env.AGENT_INTERVAL) || 30);
const DISKS = (process.env.AGENT_DISKS || (process.platform === 'win32' ? 'C:\\' : '/')).split(',').map((d) => d.trim()).filter(Boolean);
const ONCE = process.argv.includes('--once');

if (!URL_BASE || !ID || !TOKEN) {
  console.error('DASHBOARD_URL, AGENT_ID et AGENT_TOKEN sont obligatoires (commande donnée par le dashboard).');
  process.exit(1);
}

// CPU : écart entre deux relevés (le premier envoi mesure sur une seconde).
let lastCpu = os.cpus();
function cpuPercent() {
  const now = os.cpus();
  let idle = 0;
  let total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i]?.times || { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    idle += c.times.idle - p.idle;
    total += Object.keys(c.times).reduce((n, k) => n + c.times[k] - (p[k] || 0), 0);
  });
  lastCpu = now;
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

function memory() {
  // Linux : MemAvailable tient compte du cache, contrairement à os.freemem().
  try {
    const txt = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (k) => Number((txt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1]) * 1024;
    if (get('MemTotal') && get('MemAvailable')) return { total: get('MemTotal'), used: get('MemTotal') - get('MemAvailable') };
  } catch { /* pas Linux */ }
  return { total: os.totalmem(), used: os.totalmem() - os.freemem() };
}

function disks() {
  return DISKS.flatMap((mount) => {
    try {
      const s = fs.statfsSync(mount);
      return [{ mount, size: s.blocks * s.bsize, used: (s.blocks - s.bavail) * s.bsize }];
    } catch {
      return []; // disque absent ou démonté
    }
  });
}

// Température la plus haute des zones thermiques (Linux, Raspberry Pi…).
function temperature() {
  try {
    const zones = fs.readdirSync('/sys/class/thermal').filter((z) => z.startsWith('thermal_zone'));
    const values = zones.map((z) => Number(fs.readFileSync(`/sys/class/thermal/${z}/temp`, 'utf8')) / 1000).filter((v) => v > 0 && v < 150);
    return values.length ? { value: Math.round(Math.max(...values)), label: 'CPU' } : null;
  } catch {
    return null;
  }
}

function osName() {
  try {
    const m = fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (m) return m[1];
  } catch { /* pas Linux */ }
  return `${os.type()} ${os.release()}`;
}

function report() {
  const cores = os.cpus().length;
  return {
    hostname: os.hostname(),
    os: osName(),
    uptime: Math.round(os.uptime()),
    cpu: cpuPercent(),
    cpuName: os.cpus()[0]?.model?.trim() || '',
    // Pas de charge moyenne sous Windows (os.loadavg() renvoie des zéros).
    load: process.platform === 'win32' ? null : { min1: Math.round(os.loadavg()[0] * 100) / 100, cores },
    mem: memory(),
    disks: disks(),
    temp: temperature(),
    interval: INTERVAL,
  };
}

async function send() {
  const res = await fetch(`${URL_BASE}/api/agent/${encodeURIComponent(ID)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(report()),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 404) throw new Error('jeton ou identifiant refusé : recopie la commande donnée par le dashboard');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

let failures = 0;
async function loop() {
  try {
    await send();
    if (failures) console.log('Envoi rétabli.');
    failures = 0;
  } catch (e) {
    // Un message au premier échec puis toutes les 10 tentatives : pas de journal qui déborde.
    if (failures++ % 10 === 0) console.error(`Envoi impossible vers ${URL_BASE} : ${e.cause?.code || e.message}`);
    if (ONCE) process.exit(1);
  }
  if (ONCE) return;
  setTimeout(loop, INTERVAL * 1000);
}

console.log(`Agent Server Dashboard : envoi toutes les ${INTERVAL} s vers ${URL_BASE}`);
setTimeout(loop, 1000); // une seconde de mesure pour le premier relevé du CPU
