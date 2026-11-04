// Widget Spotify : ce qui joue en ce moment et les dernières écoutes.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.spotify = {
  label: 'Spotify', icon: 'spotify', kind: 'spotify', refresh: 15_000, fields: ['username', 'password'], urlOptional: true,
  userRequired: true, userLabel: 'spotify.clientId', userHelp: 'spotify.clientIdHelp', passwordLabel: 'spotify.clientSecret', passwordHelp: 'spotify.clientSecretHelp',
  renderSetup: spotifySetup,
  waitingCode: 'spotify_connect', // compte pas encore connecté : une étape normale, pas une panne
};

const fmtTrackTime = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function spotifyLink(x, content) {
  return x.url ? h('a', { href: x.url, target: '_blank', rel: 'noopener', class: 'spotify-link' }, content) : content;
}

const spotifyCover = (x, cls = '') => (x.image ? h('img', { class: `spotify-cover ${cls}`, src: x.image, alt: '', loading: 'lazy' }) : null);

RENDERERS.spotify = (d) => {
  const soon = d.expiresAt && new Date(d.expiresAt) - Date.now() < 14 * 86400_000;
  return [
    d.now ? h('div', { class: 'spotify-now' },
      spotifyCover(d.now, 'spotify-cover-large'),
      h('div', { class: 'spotify-text' },
        h('div', { class: 'item-title', title: d.now.title }, spotifyLink(d.now, d.now.title)),
        h('div', { class: 'item-sub' }, d.now.artists),
        progressBar(d.now.duration ? d.now.progress / d.now.duration : 0),
        h('div', { class: 'item-sub spotify-meta' },
          h('span', {}, `${d.now.playing ? '▶' : '⏸'} ${fmtTrackTime(d.now.progress)} / ${fmtTrackTime(d.now.duration)}`),
          h('span', {}, d.now.device)))) : h('p', { class: 'muted' }, t('spotify.idle')),
    d.recent.length ? h('div', { class: 'widget-subhead' }, t('spotify.recent')) : null,
    d.recent.length ? h('ul', { class: 'widget-list' }, d.recent.map((x) => h('li', { class: 'spotify-recent' },
      spotifyCover(x),
      h('div', { class: 'spotify-text' },
        h('div', { class: 'row' }, h('span', { class: 'item-title', title: x.title }, spotifyLink(x, x.title)),
          x.playedAt ? h('span', { class: 'muted' }, fmtAgo(x.playedAt)) : null),
        h('div', { class: 'item-sub' }, x.artists))))) : null,
    soon ? h('p', { class: 'muted widget-note' }, `⚠ ${t('spotify.expiresSoon', { duration: fmtAgo(new Date(2 * Date.now() - new Date(d.expiresAt))) })}`) : null,
  ];
};

// Connexion du compte, dans le formulaire du widget.
async function spotifySetup(text, commands, w, saved) {
  if (!saved || !w.username) {
    text.textContent = t('spotify.saveFirst');
    return;
  }
  text.textContent = t(w.hasApiKey ? 'spotify.connected' : 'spotify.connectHelp');
  let oauth;
  try {
    oauth = await api(`/api/widgets/${encodeURIComponent(w.id)}/oauth`);
  } catch (e) {
    text.textContent = errMsg(e);
    return;
  }
  const input = h('input', { type: 'url', autocomplete: 'off', placeholder: `${oauth.redirectUri}?code=…` });
  const message = h('p', { class: 'muted widget-note', role: 'status' });
  const connect = async () => {
    try {
      await api(`/api/widgets/${encodeURIComponent(w.id)}/oauth`, { method: 'POST', body: { url: input.value.trim() } });
      w.hasApiKey = true;
      input.value = '';
      message.textContent = t('spotify.connectedNow');
      refreshWidget(w.id);
    } catch (e) {
      message.textContent = errMsg(e);
    }
  };
  commands.replaceChildren(h('ol', { class: 'spotify-steps' },
    h('li', {}, t('spotify.stepApp'), ' ', h('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'developer.spotify.com'), h('br'), h('code', {}, oauth.redirectUri)),
    h('li', {}, h('a', { class: 'btn btn-sm', href: oauth.url, target: '_blank', rel: 'noopener' }, t('spotify.authorize'))),
    h('li', {}, t('spotify.stepPaste'), input, h('button', { type: 'button', class: 'btn btn-sm', onclick: connect }, t('spotify.connect')), message)));
}
