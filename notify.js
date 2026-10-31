// Notifications (mode édition > Notifications) : prévenir quand une application tombe, puis revient.
// Destinations : ntfy, Gotify, Discord ou webhook générique (POST JSON). L'URL et le jeton sont des
// secrets : ils restent sur le serveur, comme les clés API des widgets.

const { request, fail } = require('./integrations/lib');

const NOTIFY_TYPES = ['ntfy', 'gotify', 'discord', 'webhook'];

// Textes envoyés (le serveur n'affiche rien lui-même : seule exception, les messages de notification,
// dans la langue choisie à l'enregistrement).
const TEXTS = {
  fr: {
    down: '🔴 {name} est hors ligne',
    up: '🟢 {name} est de nouveau en ligne',
    disk_down: '🟠 Disque presque plein : {name} ({value} %)',
    disk_up: '🟢 Disque de nouveau sous 90 % : {name} ({value} %)',
    cert_down: '🟠 Certificat à renouveler : {name} ({value} j restants)',
    cert_up: '🟢 Certificat renouvelé : {name}',
    backup_down: '🔴 Tâche de sauvegarde en échec : {name} ({value} sur 24 h)',
    backup_up: '🟢 Plus aucune tâche de sauvegarde en échec depuis 24 h : {name}',
    smart_down: '🔴 Disque en mauvaise santé (SMART) : {name}',
    smart_up: '🟢 Disque de nouveau sain : {name}',
    attacks_down: '🛡️ Pic d’attaques détecté par {name} : {value} sur 24 h',
    attacks_up: '🟢 Attaques revenues à la normale : {name} ({value} sur 24 h)',
    test: '✅ Notification de test',
    testBody: 'Les notifications de Server Dashboard fonctionnent.',
  },
  en: {
    down: '🔴 {name} is down',
    up: '🟢 {name} is back up',
    disk_down: '🟠 Disk almost full: {name} ({value}%)',
    disk_up: '🟢 Disk back under 90%: {name} ({value}%)',
    cert_down: '🟠 Certificate to renew: {name} ({value} days left)',
    cert_up: '🟢 Certificate renewed: {name}',
    backup_down: '🔴 Backup task failed: {name} ({value} in 24 h)',
    backup_up: '🟢 No failed backup task for 24 h: {name}',
    smart_down: '🔴 Disk health failing (SMART): {name}',
    smart_up: '🟢 Disk healthy again: {name}',
    attacks_down: '🛡️ Attack spike detected by {name}: {value} in 24 h',
    attacks_up: '🟢 Attacks back to normal: {name} ({value} in 24 h)',
    test: '✅ Test notification',
    testBody: 'Server Dashboard notifications are working.',
  },
};

function text(lang, key, vars = {}) {
  return (TEXTS[lang] || TEXTS.fr)[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// Les services publics reçoivent un secret (le webhook Discord contient son jeton) : certificat
// vérifié. Un serveur auto-hébergé (Gotify, ntfy maison) garde le comportement des autres services.
const PUBLIC_HOSTS = /(^|\.)(ntfy\.sh|discord\.com|discordapp\.com)$/i;

// event : { kind: 'down' | 'up' | 'test', name, url, board, problem?, value? } ; problem : 'disk',
// 'cert', 'backup' ou 'smart' (alertes des widgets) pour un message adapté.
function message(notify, event) {
  const key = event.problem ? `${event.problem}_${event.kind}` : event.kind;
  const title = event.kind === 'test' ? text(notify.lang, 'test') : text(notify.lang, key, { name: event.name, value: event.value });
  const body = event.kind === 'test' ? text(notify.lang, 'testBody') : event.url || '';
  return { title, body, board: event.board || 'Server Dashboard' };
}

function buildRequest(notify, event) {
  const { title, body, board } = message(notify, event);
  const json = (obj, headers = {}) => ({ body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json', ...headers } });
  const bearer = notify.token ? { Authorization: `Bearer ${notify.token}` } : {};
  switch (notify.type) {
    case 'ntfy': {
      // En-têtes HTTP : encodés en RFC 2047 par ntfy s'ils ne sont pas ASCII ; le titre passe donc dans
      // le corps JSON (publication JSON de ntfy) pour garder accents et émojis. Le sujet est le dernier
      // segment du chemin (sans ?… ni #…), la publication se fait sur le chemin parent.
      const u = new URL(notify.url);
      const parts = u.pathname.split('/').filter(Boolean);
      const topic = parts.pop() || '';
      return {
        url: `${u.origin}/${parts.join('/')}`,
        ...json({
          topic,
          title: `${board} · ${title}`, message: body || title,
          priority: event.kind === 'down' ? 4 : 3, tags: [event.kind === 'down' ? 'red_circle' : 'green_circle'],
        }, bearer),
      };
    }
    case 'gotify':
      return {
        url: `${notify.url.replace(/\/+$/, '')}/message`,
        ...json({ title: `${board} · ${title}`, message: body || title, priority: event.kind === 'down' ? 8 : 4 }, { 'X-Gotify-Key': notify.token }),
      };
    case 'discord':
      return { url: notify.url, ...json({ username: board, content: `**${title}**${body ? `\n${body}` : ''}` }) };
    default: // webhook
      return {
        url: notify.url,
        ...json({ event: event.kind, title, message: body, app: event.name ? { name: event.name, url: event.url || '' } : null, board, time: new Date().toISOString() }, bearer),
      };
  }
}

async function sendNotification(notify, event) {
  if (!NOTIFY_TYPES.includes(notify?.type) || !notify.url) throw fail('notify_missing', 'Notifications non configurées');
  let req;
  try {
    req = buildRequest(notify, event);
  } catch {
    throw fail('invalid_url', `URL invalide : ${notify.url}`, { url: notify.url });
  }
  const verifyTls = PUBLIC_HOSTS.test(new URL(req.url).hostname);
  const r = await request(req.url, {
    method: 'POST', body: req.body, verifyTls,
    headers: { ...req.headers, 'Content-Length': Buffer.byteLength(req.body) }, maxBytes: 64 * 1024,
  });
  if (r.status === 401 || r.status === 403) throw fail('notify_auth', 'Jeton refusé par le service de notification');
  if (r.status >= 400) throw fail('notify_failed', `HTTP ${r.status}`, { status: r.status });
}

// Suivi de l'état des applications : notification au changement seulement, après FAILS_BEFORE_DOWN
// échecs de suite (une coupure d'une seconde ne réveille personne). Rien à la première vérification :
// une app déjà hors ligne au démarrage n'a pas d'alerte, ni donc de « retour » quand elle revient.
const FAILS_BEFORE_DOWN = 2;

function createMonitor() {
  const apps = new Map(); // id de l'app -> { down, fails, alerted } (alerted : « hors ligne » envoyé)
  return {
    // statuses : { id: { online } } ; renvoie les événements à envoyer.
    update(appList, statuses) {
      const events = [];
      const ids = new Set();
      for (const app of appList) {
        const s = statuses[app.id];
        if (!s) continue;
        ids.add(app.id);
        const known = apps.get(app.id);
        if (!known) {
          apps.set(app.id, { down: !s.online, fails: s.online ? 0 : FAILS_BEFORE_DOWN, alerted: false });
          continue;
        }
        if (s.online) {
          if (known.down && known.alerted) events.push({ kind: 'up', id: app.id, name: app.name, url: app.url, problem: app.problem, value: app.value });
          Object.assign(known, { down: false, fails: 0, alerted: false });
        } else if (!known.down && ++known.fails >= FAILS_BEFORE_DOWN) {
          Object.assign(known, { down: true, alerted: true });
          events.push({ kind: 'down', id: app.id, name: app.name, url: app.url, problem: app.problem, value: app.value });
        }
      }
      for (const id of apps.keys()) if (!ids.has(id)) apps.delete(id); // app supprimée
      return events;
    },
    // Envoi impossible (service de notification injoignable) : l'événement repartira à la prochaine
    // vérification si l'état n'a pas changé entre-temps.
    failed(event) {
      const known = apps.get(event.id);
      if (!known) return;
      if (event.kind === 'down' && known.down) Object.assign(known, { down: false, fails: FAILS_BEFORE_DOWN - 1, alerted: false });
      if (event.kind === 'up' && !known.down) Object.assign(known, { down: true, fails: FAILS_BEFORE_DOWN, alerted: true });
    },
    clear() { apps.clear(); },
  };
}

module.exports = { NOTIFY_TYPES, sendNotification, createMonitor, message };
