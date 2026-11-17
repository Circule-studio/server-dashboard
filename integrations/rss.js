// Flux RSS / Atom : derniers articles d'un ou plusieurs flux, mélangés par date. Lecture sans
// dépendance des deux formats (RSS 2.0 et 1.0, Atom). Les titres sont renvoyés en texte brut
// (balises retirées, entités décodées) et seuls les liens http(s) sont gardés.

const { request, fail } = require('./lib');

const MAX_ITEMS = 10;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

// Texte d'un élément : CDATA déballées, balises HTML retirées (un titre peut contenir du HTML
// échappé), entités décodées, espaces réduits.
function textOf(raw) {
  if (raw == null) return '';
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decode(decode(unwrapped).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Les recherches ci-dessous avancent toujours : une balise ouverte sans fermeture arrête la lecture au lieu
// de faire reparcourir la fin du document à chaque candidate (temps quadratique, dashboard figé : #147).
const MAX_FIELD = 16 * 1024; // un titre, un lien ou une date n'a pas besoin de plus

// Contenu du premier élément `tag` (avec ou sans préfixe d'espace de noms, ex. dc:date).
function tagContent(xml, tag) {
  const open = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^<>]*)?>`, 'i').exec(xml);
  if (!open) return null;
  const close = new RegExp(`</(?:[\\w-]+:)?${tag}>`, 'ig');
  close.lastIndex = open.index + open[0].length;
  const end = close.exec(xml);
  return end ? xml.slice(open.index + open[0].length, end.index).slice(0, MAX_FIELD) : null;
}

// Blocs <item>…</item> ou <entry>…</entry>, en un seul passage, MAX_FEED_ITEMS au plus par flux : seuls
// les plus récents sont affichés. Un bloc n'est lu que sur ses MAX_BLOCK premiers caractères (titre, lien, date).
const MAX_FEED_ITEMS = 50;
const MAX_BLOCK = 256 * 1024;
function blocksOf(xml, tag) {
  const lower = xml.toLowerCase();
  const out = [];
  for (let i = 0; out.length < MAX_FEED_ITEMS;) {
    const start = lower.indexOf(`<${tag}`, i);
    if (start < 0) break;
    const after = lower[start + tag.length + 1];
    if (after !== '>' && !/\s/.test(after || '')) { i = start + tag.length + 1; continue; } // <itemfoo>
    const end = lower.indexOf(`</${tag}>`, start);
    if (end < 0) break; // pas de fermeture : rien d'autre à lire
    out.push(xml.slice(start, Math.min(end + tag.length + 3, start + MAX_BLOCK)));
    i = end + tag.length + 3;
  }
  return out;
}

const safeLink = (href) => {
  const url = textOf(href);
  return /^https?:\/\//i.test(url) ? url : '';
};

// Lien d'un article Atom : rel="alternate" (ou sans rel) de préférence.
function atomLink(entry) {
  const links = [...entry.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => ({
    href: (m[1].match(/\bhref\s*=\s*["']([^"']*)["']/i) || [])[1] || '',
    rel: (m[1].match(/\brel\s*=\s*["']([^"']*)["']/i) || [])[1] || 'alternate',
  }));
  return safeLink((links.find((l) => l.rel === 'alternate') || links[0])?.href || '');
}

function parseFeed(xml, url) {
  const isAtom = /<feed[\s>]/i.test(xml);
  if (!isAtom && !/<(rss|rdf:RDF|channel)[\s>]/i.test(xml)) throw fail('rss_invalid', 'Ce n\'est pas un flux RSS ou Atom', { url });
  const blocks = blocksOf(xml, isAtom ? 'entry' : 'item');
  // Titre du flux : celui qui précède le premier article.
  const first = xml.search(isAtom ? /<entry[\s>]/i : /<item[\s>]/i);
  const head = first > 0 ? xml.slice(0, first) : xml;
  const source = textOf(tagContent(head, 'title')) || new URL(url).hostname;
  return blocks.map((b) => {
    const date = Date.parse(textOf(tagContent(b, isAtom ? 'updated' : 'pubDate') ?? tagContent(b, 'published') ?? tagContent(b, 'date')));
    return {
      title: textOf(tagContent(b, 'title')) || '—',
      link: isAtom ? atomLink(b) : safeLink(tagContent(b, 'link') || ''),
      date: Number.isNaN(date) ? null : new Date(date).toISOString(),
      source,
    };
  });
}

async function readFeed(url) {
  const r = await request(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' } });
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  return parseFeed(r.text, url);
}

async function rss(w) {
  const results = await Promise.allSettled(w.feeds.map(readFeed));
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw results[0].reason; // aucun flux lisible : la première erreur
  const items = ok.flatMap((r) => r.value)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, MAX_ITEMS);
  return { items, failed: results.length - ok.length };
}

module.exports = {
  rss: { fields: ['feeds'], cacheMs: 15 * 60_000, fetch: rss, parse: parseFeed },
};
