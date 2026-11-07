# Widgets

🇫🇷 [Version française](WIDGETS.fr.md) · [Back to the README](../README.md) · [Guide](GUIDE.md)

The 40 widgets by family, then [where to find their credentials](#where-to-find-the-credentials). Add one with **Log in > Edit > + Widget**.

## Servers and backups

- **Proxmox VE**: host CPU / RAM / disk, every VM and LXC container, storage, with history charts for each of them.
- **Proxmox Backup Server**: successful and failed backups over the last 24 h, datastore usage.
- **Proxmox backups**: latest backup (date, success or failure), size and date per machine, machines in no scheduled backup, storage and next backup; alert on failure.
- **Script backup**: the result of your own script (rsync to a USB disk…): date, size, success or failure, history; alert on failure or delay.
- **Pulse**: fleet health, active alerts, nodes / VMs / LXC, as blocks you can place freely.
- **Glances**: CPU, memory, disks, temperature and uptime of another machine (PC, Raspberry Pi, NAS…), one widget per machine; a machine that is off is clearly shown.
- **Agent**: CPU, memory, disks and temperature of a machine behind NAT or without an open port; the machine contacts the dashboard. With history charts, network included. See [agent/README.md](../agent/README.md) (in French).
- **Updates**: pending apt packages (including security ones) and Docker images, for the dashboard server and each machine with an agent. Display only, nothing is installed.
- **Scrutiny**: SMART disk health, failing disks first, with their temperature.
- **Watchtower**: containers checked, to update and failed during the last run.

## Media

- **Jellyfin / Plex**: now playing, library size.
- **qBittorrent**: speeds, active torrents.
- **Sonarr / Radarr / Lidarr / Readarr**: upcoming episodes, movies, albums and books, download queue.
- **Prowlarr**: active and paused indexers, queries and grabs. **Bazarr**: episodes and movies missing subtitles.
- **Spotify**: what is playing now (title, cover, progress, device) and recent listening, hidden from visitors who are not logged in.
- **Immich**: photo and video counts, storage used, per-user breakdown with quotas, plus `dl-stats` download totals when present.

## Network and security

- **Pi-hole / AdGuard Home**: DNS queries, blocked queries and percentage, protection status (including a running pause).
- **CrowdSec**: attacks detected on your server in the last 24 h (address, country, ISP, scenario), the most active ones, and banned addresses; alert on a spike.
- **Wazuh**: active and disconnected agents and, with the indexer, security alerts over 24 h by severity; alert when an agent disconnects or on a critical alert.
- **Authelia**: successful, refused and blocked logins, two-factor authentication, allowed and denied access.
- **Traefik**: routers, services and middlewares, with those in error or warning; alert when a router goes into error.
- **Nginx Proxy Manager**: active and disabled hosts, SSL certificates sorted by expiry date, those expiring within 14 days highlighted.
- **Uptime Kuma**: monitors from a status page, those down first, with response time and 24 h uptime.
- **Speedtest Tracker**: latest speed test, 7-day average and recent tests.

## Home and daily life

- **Home Assistant**: the sensors you choose (temperature, power, doors, motion, lights, presence…), with their translated state and since when.
- **Frigate**: cameras online and frames per second, detection speed, latest events (person, car…) with their thumbnail, served by the dashboard.
- **Weather**: current conditions and a 5-day forecast ([Open-Meteo](https://open-meteo.com), no API key).
- **Calendar**: events of the next 7 days from one or more iCal calendars (Nextcloud, Google Calendar, Proton…), recurring ones included, grouped by day.
- **RSS / Atom feeds**: the 10 latest articles of one or more feeds, mixed by date.

## Web and development

- **Loki / Grafana**: log volume and errors over the last 24 h, with the latest error lines and the noisiest sources.
- **GoAccess**: a website’s unique visitors (total, today, last 7 days), requests and traffic, from a GoAccess JSON report.
- **Alwaysdata**: the sites of a hosting account, each checked by the dashboard (up, down, response time), down ones first.
- **GitHub**: follow a repository, with its latest release, unreleased commits since then, open issues and pull requests.
- **Custom API**: any JSON API (a service without a widget, your own script): pick the values to show by their path in the response, with a format (number, percent, bytes, rate, date).

## Where to find the credentials

| Service | Fields | Where to find them |
|---|---|---|
| Proxmox VE | URL (`https://IP:8006`) + API token ID and secret | `pveum user token add root@pam dashboard --privsep 1` then `pveum acl modify / --tokens "root@pam!dashboard" --roles PVEAuditor` (read-only) |
| Proxmox Backup Server | URL (`https://IP:8007`) + API token ID and secret | Configuration > Access Control > API Token, with the **Audit** role on `/` for the token (read-only) |
| Scrutiny | Web interface URL (`http://IP:8080`) | No key |
| Speedtest Tracker | URL + optional API token | v1: Settings > API Tokens (read). Without a token: legacy public API (v0) |
| Pulse | URL (`http://IP:7655`) + API token | Pulse > Settings > API Access, `monitoring:read` scope only |
| Pi-hole (v6) | URL (`http://IP`) + password | The web interface password. With 2FA: an app password (Settings > Web interface / API, Expert mode, "Configure app password"). Empty if Pi-hole has no password |
| AdGuard Home | URL (`http://IP`) + username / password | The web interface credentials (empty if it has none) |
| Immich | URL (`http://IP:2283`) + API key | Account Settings > API Keys, from an **admin** account (`server.statistics` permission if the key is restricted) |
| Alwaysdata | API token + account name (optional) | Alwaysdata > Profile > Token management. The account is only needed if the token manages several. The widget only reads the list of sites, then checks their first address itself (HTTPS, else HTTP) |
| Calendar | `.ics` address(es) + optional username / password | Nextcloud: ⋯ > Copy private link; Google Calendar: Settings > Secret address in iCal format. Several calendars: addresses separated by a space. The address is kept on the server like a key |
| CrowdSec | Local API URL (`http://IP:8080`) + machine account **or** bouncer key | On the CrowdSec machine: `cscli machines add dashboard --password …` (detailed attacks: country, ISP, scenario) or `cscli bouncers add dashboard` (read-only: banned addresses). The community blocklist is not counted as an attack |
| GoAccess | URL of the JSON report (`goaccess … -o report.json`) | No key. To expose nothing sensitive, generate a report limited to the visitors panel (`--ignore-panel` for all others, including `HOSTS`): it contains no IP address |
| Weather | Location: a city (`London`, `Paris, France`) or coordinates (`51.5, -0.12`) | No account. The URL is optional: only for a self-hosted Open-Meteo instance |
| Uptime Kuma | URL (`http://IP:3001`) + status page name, or the full page address | No key: status pages are public (Uptime Kuma > Status Pages) |
| Glances | URL (`http://IP:61208`) + optional password | Run `glances -w` on the machine (add `--password` to require one; username `glances` by default) |
| Frigate | URL (`http://IP:5000`), or `https://IP:8971` + username / password | Port 5000: nothing to enter. Port 8971 (Frigate 0.14+): a Frigate account, ideally with the "viewer" role. Thumbnails go through the dashboard and follow `REQUIRE_LOGIN` |
| Home Assistant | URL (`http://IP:8123`) + token + entities (one per line) | Your profile > Security > Long-lived access tokens. Entity IDs (`sensor.living_room_temperature`) are in Settings > Devices & services > Entities |
| Nginx Proxy Manager | URL (`http://IP:81`) + e-mail / password | The admin interface account. A dedicated account with read access to "Proxy Hosts" is enough |
| GitHub | Repository (`owner/repo` or its address) + optional token | Token required for a private repository: Settings > Developer settings > *Fine-grained tokens*, read-only (Contents, Issues, Pull requests, Metadata). Without a token, GitHub allows 60 requests per hour: refreshed every 15 min (2 min with a token), enough for 4 or 5 widgets. If the limit is reached, the last data stays on screen. The API URL is only for GitHub Enterprise |
| Custom API | URL returning JSON + values (one per line: `path \| label \| format`) + optional authentication | Dotted path: `data.users.count`, `items.0.name`, `list.length`. Formats: text, number, percent, bytes, rate, date. Authentication: a header (`X-Api-Key: …`, or a bare value sent as `Authorization: Bearer …`) or username / password (Basic) |
| Jellyfin | URL + API key | Dashboard > API Keys |
| Plex | URL + token | Your `X-Plex-Token` |
| qBittorrent | URL + Web UI username / password | Options > Web UI |
| Sonarr / Radarr / Lidarr / Readarr / Prowlarr | URL + API key | Settings > General > API Key |
| Bazarr | URL (`http://IP:6767`) + API key | Settings > General > Security > API Key |
| Wazuh | Manager API URL (`https://IP:55000`) + API username and password; optional: indexer URL (`https://IP:9200`) and indexer `username:password` | A Wazuh API account (ideally with the `readonly` role). Without the indexer, only agents are shown. Self-signed certificates are accepted |
| Spotify | Client ID + Client Secret of an app created on [developer.spotify.com](https://developer.spotify.com/dashboard), then log in to the account in the widget | Its owner must have **Spotify Premium** (Spotify's rule). Save the widget, reopen it and follow the three steps. If the dashboard is not on https, the return page doesn't display: copy its address. The login must be redone every 6 months |
| Loki / Grafana | Loki URL (`http://IP:3100`); username and password if a reverse proxy protects it; or Grafana URL with the source path (`https://grafana/api/datasources/proxy/uid/UID`) and a service account token (Viewer role) | Optional LogQL selector, for example `{job="varlogs"}`. Error lines are only shown to admins |
| Authelia | Metrics URL (`http://IP:9959`) | In its configuration: `telemetry: { metrics: { enabled: true } }`. Counters since it started. Authelia doesn't publish the number of active sessions |
| Watchtower | API URL (`http://IP:8080`) + token | Run with `WATCHTOWER_HTTP_API_METRICS=true` and `WATCHTOWER_HTTP_API_TOKEN`. Its metrics give neither container names nor the run date: the dashboard notes when it sees a new run. For names, see the Updates widget. Watchtower has not been maintained since 2025 |
| Proxmox backups | Same as Proxmox VE: URL, token ID and secret (PVEAuditor role) | Reads `vzdump` tasks and backup storage, including a USB disk mounted in Proxmox |
| Script backup | Nothing: the token is generated | Save the widget, reopen it, and paste the lines shown at the end of your script. Adapt the path and `everyHours` (hours between two backups, to detect a delay) |
| Traefik | API URL (`http://IP:8080` or the router that publishes `api@internal`); username and password if a basicAuth middleware protects it | Enable `api.dashboard` (or `api.insecure` on a private network) in Traefik's static configuration |
| Agent | The machine's name | Save the widget, reopen it and run the command shown. See [agent/README.md](../agent/README.md) (in French) |
| Updates | Nothing | It follows the dashboard server and the machines with an Agent widget |
| RSS / Atom feeds | Feed addresses, one per line (10 at most) | No key |

URLs must be reachable **from the dashboard server** (for example `http://jellyfin:8096` if both are on the same Docker network). Keys and passwords stay on the server: they are never sent back to the browser.
