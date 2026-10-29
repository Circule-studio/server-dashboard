// Faux flux : /rss.xml (RSS 2.0, avec CDATA, HTML dans un titre et un lien javascript:),
// /atom.xml (Atom) et /pas-un-flux (page HTML, pour l'erreur).

const { http } = require('./lib');

const ago = (h) => new Date(Date.now() - h * 3600_000);

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Blog du homelab</title><link>https://blog.example.com/</link>
  <item><title><![CDATA[Proxmox 9 : <b>migration</b> &amp; retour d'expérience]]></title>
    <link>https://blog.example.com/proxmox-9</link><pubDate>${ago(2).toUTCString()}</pubDate></item>
  <item><title>Sauvegardes &lt;em&gt;3-2-1&lt;/em&gt; avec restic</title>
    <link>javascript:alert(1)</link><pubDate>${ago(30).toUTCString()}</pubDate></item>
  <item><title>Un vieil article</title><link>https://blog.example.com/vieux</link>
    <pubDate>${ago(24 * 40).toUTCString()}</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Notes de version</title>
  <link href="https://releases.example.com/"/>
  <entry><title type="html">v2.0 &#8212; nouveautés</title>
    <link rel="alternate" href="https://releases.example.com/v2.0"/><link rel="edit" href="https://releases.example.com/edit/2"/>
    <updated>${ago(5).toISOString()}</updated></entry>
  <entry><title>v1.9</title><link href="https://releases.example.com/v1.9"/>
    <updated>${ago(24 * 10).toISOString()}</updated></entry>
</feed>`;

http.createServer((req, res) => {
  if (req.url === '/rss.xml') { res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' }); return res.end(RSS); }
  if (req.url === '/atom.xml') { res.writeHead(200, { 'Content-Type': 'application/atom+xml; charset=utf-8' }); return res.end(ATOM); }
  if (req.url === '/pas-un-flux') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><body>Bonjour</body></html>'); }
  res.writeHead(404);
  res.end();
}).listen(18090);
