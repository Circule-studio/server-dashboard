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

// Contenu du premier élément `tag` (avec ou sans préfixe d'espace de noms, ex. dc:date).
function tagContent(xml, tag) {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i'));
  return m ? m[1] : null;
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
  const blocks = [...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
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
  rss: { fields: ['feeds'], cacheMs: 15 * 60_000, fetch: rss },
};
