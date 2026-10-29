# Server Dashboard

🇫🇷 [Version française](README.md)

A lightweight, self-hosted dashboard (Homarr-style) to reach all the services of your homelab from a single page. The interface is available in **English and French** (switch with the EN / FR button).

**🌐 Project website: [circule-studio.github.io/server-dashboard/en](https://circule-studio.github.io/server-dashboard/en/)**

![Dashboard overview: server stats, Proxmox, Jellyfin, qBittorrent, Sonarr, Radarr widgets, app tiles and Docker containers](docs/screenshots/dashboard.png)

## Features

- **App tiles** grouped by category, with icons ([dashboardicons.com](https://dashboardicons.com)) and an online / offline indicator checked **server-side** (works for LAN-only services).
- **Server stats**: CPU, memory, uptime and **as many disks as you want** (auto-detected, custom names).
- **Docker panel**: list containers, start / stop / restart them.
- **Widgets**:
  - **Proxmox VE**: host CPU / RAM / disk, every VM and LXC container, storage.
  - **Uptime Kuma**: monitors from a status page, those down first, with response time and 24 h uptime.
  - **Glances**: CPU, memory, disks, temperature and uptime of another machine (PC, Raspberry Pi, NAS…), one widget per machine; a machine that is off is clearly shown.
  - **Pulse**: fleet health, active alerts, nodes / VMs / LXC, as blocks you can place freely.
  - **Pi-hole / AdGuard Home**: DNS queries, blocked queries and percentage, protection status (including a running pause).
  - **Immich**: photo and video counts, storage used, per-user breakdown with quotas.
  - **Weather**: current conditions and a 5-day forecast ([Open-Meteo](https://open-meteo.com), no API key).
  - **Frigate**: cameras online and frames per second, detection speed, latest events (person, car…) with their thumbnail, served by the dashboard.
  - **Home Assistant**: the sensors you choose (temperature, power, doors, motion, lights, presence…), with their translated state and since when.
  - **Nginx Proxy Manager**: active and disabled hosts, SSL certificates sorted by expiry date, those expiring within 14 days highlighted.
  - **GitHub**: follow a repository, with its latest release, unreleased commits since then, open issues and pull requests.
  - **Jellyfin / Plex**: now playing, library size.
  - **qBittorrent**: speeds, active torrents.
  - **Sonarr / Radarr**: upcoming episodes and movies, download queue.
- **Edit mode** (password protected) with drag & drop, and a welcome screen on first launch.
- **Notifications** to ntfy, Gotify, Discord or a webhook when an app goes down and when it comes back: the server checks every minute, even with the dashboard closed.
- **Backup**: export the configuration to a file (with or without API keys), and import it to restore it or copy it to another machine.
- API keys and passwords **never leave the server**.

Stack: Node.js + Express, plain HTML / CSS / JS (no build step), configuration stored in a JSON file.

## Install with Docker

The image is published at `ghcr.io/circule-studio/server-dashboard` for **amd64 and arm64** (Raspberry Pi included). No need to clone the repository:

```bash
mkdir server-dashboard && cd server-dashboard
curl -fsSLO https://raw.githubusercontent.com/Circule-studio/server-dashboard/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Circule-studio/server-dashboard/main/.env.example -o .env
```

Edit `.env` and replace `change-moi` with a real password, then:

```bash
docker compose up -d
```

Open `http://SERVER-IP:7575`: a welcome screen guides you. **Update**: `docker compose pull && docker compose up -d` (your config stays in `./data`).

## Install without Docker (Debian / Ubuntu, Proxmox LXC)

One command, as root, on Debian 12+ or Ubuntu 22.04+ with systemd:

```bash
curl -fsSL https://raw.githubusercontent.com/Circule-studio/server-dashboard/main/packaging/install.sh | sudo bash
```

It installs Node.js if needed, creates a `server-dashboard` systemd service and prints a generated admin password once. Run the same command again to **update**; add `-s -- --uninstall` to remove it.

| What | Where |
|---|---|
| Settings (password, port, `REQUIRE_LOGIN`…) | `/etc/server-dashboard/server-dashboard.env`, then `sudo systemctl restart server-dashboard` |
| Dashboard config (tiles, widgets) | `/var/lib/server-dashboard/` |
| Logs | `journalctl -u server-dashboard -f` |

## Widget credentials

| Service | Fields | Where to find them |
|---|---|---|
| Proxmox VE | URL (`https://IP:8006`) + API token ID and secret | `pveum user token add root@pam dashboard --privsep 1` then `pveum acl modify / --tokens "root@pam!dashboard" --roles PVEAuditor` (read-only) |
| Pulse | URL (`http://IP:7655`) + API token | Pulse > Settings > API Access, `monitoring:read` scope only |
| Pi-hole (v6) | URL (`http://IP`) + password | The web interface password. With 2FA: an app password (Settings > Web interface / API, Expert mode, "Configure app password"). Empty if Pi-hole has no password |
| AdGuard Home | URL (`http://IP`) + username / password | The web interface credentials (empty if it has none) |
| Immich | URL (`http://IP:2283`) + API key | Account Settings > API Keys, from an **admin** account (`server.statistics` permission if the key is restricted) |
| Weather | Location: a city (`London`, `Paris, France`) or coordinates (`51.5, -0.12`) | No account. The URL is optional: only for a self-hosted Open-Meteo instance |
| Uptime Kuma | URL (`http://IP:3001`) + status page name, or the full page address | No key: status pages are public (Uptime Kuma > Status Pages) |
| Glances | URL (`http://IP:61208`) + optional password | Run `glances -w` on the machine (add `--password` to require one; username `glances` by default) |
| Frigate | URL (`http://IP:5000`), or `https://IP:8971` + username / password | Port 5000: nothing to enter. Port 8971 (Frigate 0.14+): a Frigate account, ideally with the "viewer" role. Thumbnails go through the dashboard and follow `REQUIRE_LOGIN` |
| Home Assistant | URL (`http://IP:8123`) + token + entities (one per line) | Your profile > Security > Long-lived access tokens. Entity IDs (`sensor.living_room_temperature`) are in Settings > Devices & services > Entities |
| Nginx Proxy Manager | URL (`http://IP:81`) + e-mail / password | The admin interface account. A dedicated account with read access to "Proxy Hosts" is enough |
| GitHub | Repository (`owner/repo` or its address) + optional token | Token required for a private repository: Settings > Developer settings > *Fine-grained tokens*, read-only (Contents, Issues, Pull requests, Metadata). Without a token, GitHub allows 60 requests per hour: refreshed every 15 min (2 min with a token), enough for 4 or 5 widgets. If the limit is reached, the last data stays on screen. The API URL is only for GitHub Enterprise |
| Jellyfin | URL + API key | Dashboard > API Keys |
| Plex | URL + token | Your `X-Plex-Token` |
| qBittorrent | URL + Web UI username / password | Options > Web UI |
| Sonarr / Radarr | URL + API key | Settings > General > API Key |

URLs must be reachable **from the dashboard server**.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `7575` | HTTP port |
| `ADMIN_PASSWORD` | `admin` | Edit-mode password (a warning is shown while it is the default) |
| `REQUIRE_LOGIN` | `false` | `true`: login required even to view the dashboard |
| `SERVER_NAME` | machine name | Name shown next to the title |
| `DISK_PATH` | `/` (`C:\` on Windows) | Disk shown until disks are chosen in edit mode |
| `TRUST_PROXY` | – | Behind a reverse proxy, set to `1` so login rate limiting sees real client IPs |
| `DATA_DIR` | `./data` | Config and session secret folder |

## Security

- The Docker panel gives root-equivalent access to the host. **Do not expose the dashboard directly to the internet**: use a reverse proxy with HTTPS or a VPN, and set `REQUIRE_LOGIN=true` if it is reachable from outside.
- Login attempts are limited to 10 per IP every 15 minutes. Changing `ADMIN_PASSWORD` logs out every session.
- Found a vulnerability? Please report it privately, see [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome, especially on the interface and new widgets. Pull requests target the **`preprod`** branch. Run `npm run dev` and `npm run mocks` (fake Proxmox, Pulse, Jellyfin, Plex, qBittorrent, Sonarr, Radarr, Open-Meteo, Immich, Pi-hole, AdGuard Home, Glances, Uptime Kuma, Frigate, Home Assistant, Nginx Proxy Manager, GitHub and Docker) to work without installing anything. Details (in French) in [CONTRIBUTING.md](CONTRIBUTING.md); interface texts live in [`public/i18n.js`](public/i18n.js), add both French and English.

License: [MIT](LICENSE).
