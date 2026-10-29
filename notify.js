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
    test: '✅ Notification de test',
    testBody: 'Les notifications de Server Dashboard fonctionnent.',
  },
  en: {
    down: '🔴 {name} is down',
    up: '🟢 {name} is back up',
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

// event : { kind: 'down' | 'up' | 'test', name, url, board }
function message(notify, event) {
  const title = event.kind === 'test' ? text(notify.lang, 'test') : text(notify.lang, event.kind, { name: event.name });
  const body = event.kind === 'test' ? text(notify.lang, 'testBody') : event.url || '';
  return { title, body, board: event.board || 'Server Dashboard' };
}

function buildRequest(notify, event) {
  const { title, body, board } = message(notify, event);
  const json = (obj, headers = {}) => ({ body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json', ...headers } });
  const bearer = notify.token ? { Authorization: `Bearer ${notify.token}` } : {};
  switch (notify.type) {
    case 'ntfy':
      // En-têtes HTTP : encodés en RFC 2047 par ntfy s'ils ne sont pas ASCII ; le titre passe donc dans
      // le corps JSON (publication JSON de ntfy) pour garder accents et émojis.
      return {
        url: notify.url.replace(/\/([^/]+)\/?$/, ''),
        ...json({
          topic: notify.url.match(/\/([^/]+)\/?$/)?.[1] || '',
          title: `${board} · ${title}`, message: body || title,
          priority: event.kind === 'down' ? 4 : 3, tags: [event.kind === 'down' ? 'red_circle' : 'green_circle'],
        }, bearer),
      };
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
  const req = buildRequest(notify, event);
  let verifyTls = false;
  try { verifyTls = PUBLIC_HOSTS.test(new URL(req.url).hostname); } catch { throw fail('invalid_url', `URL invalide : ${req.url}`, { url: req.url }); }
  const r = await request(req.url, {
    method: 'POST', body: req.body, verifyTls,
    headers: { ...req.headers, 'Content-Length': Buffer.byteLength(req.body) }, maxBytes: 64 * 1024,
  });
  if (r.status === 401 || r.status === 403) throw fail('notify_auth', 'Jeton refusé par le service de notification');
  if (r.status >= 400) throw fail('notify_failed', `HTTP ${r.status}`, { status: r.status });
}

// Suivi de l'état des applications : notification au changement seulement, après FAILS_BEFORE_DOWN
// échecs de suite (une coupure d'une seconde ne réveille personne), jamais à la première vérification.
const FAILS_BEFORE_DOWN = 2;

function createMonitor() {
  const apps = new Map(); // id de l'app -> { down, fails }
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
        if (!known) { apps.set(app.id, { down: !s.online, fails: s.online ? 0 : FAILS_BEFORE_DOWN }); continue; }
        if (s.online) {
          if (known.down) events.push({ kind: 'up', name: app.name, url: app.url });
          Object.assign(known, { down: false, fails: 0 });
        } else if (!known.down && ++known.fails >= FAILS_BEFORE_DOWN) {
          known.down = true;
          events.push({ kind: 'down', name: app.name, url: app.url });
        }
      }
      for (const id of apps.keys()) if (!ids.has(id)) apps.delete(id); // app supprimée
      return events;
    },
    clear() { apps.clear(); },
  };
}

module.exports = { NOTIFY_TYPES, sendNotification, createMonitor };
