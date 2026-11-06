# Guide

🇫🇷 [Version française](GUIDE.md) · [Back to the README](../README.en.md) · [Widgets](WIDGETS.en.md)

- [Features in detail](#features-in-detail)
- [Installation details](#installation-details)
- [Several disks](#several-disks)
- [Environment variables](#environment-variables)
- [Security](#security)
- [API](#api)
- [Local development](#local-development)

## Features in detail

- **App tiles** grouped by category, with icons ([dashboardicons.com](https://dashboardicons.com)) and an online / offline indicator. The check is done by the server, so it also works for LAN-only services. A tile can be **linked to its Proxmox VM or LXC, or to its Docker container**, to show their CPU and RAM.
- **Server stats**: CPU, memory, disks and uptime, refreshed every 5 seconds.
- **Docker panel**: containers and their state, with start, stop and restart.
- **Quick search**: just start typing anywhere. It filters the tiles and offers, from the keyboard, the tile to open, the typed address (`nas.home:8080`) or a web search (DuckDuckGo, Google, Qwant…, or a custom address, set in Display).
- **Edit mode**, password protected: add, change or remove apps and categories, and reorder them by drag and drop. A welcome screen guides you on first launch.
- **Tabs** (for example "Home", "Servers", "Media") to spread widgets and categories over several pages, with a direct link per tab (`#media`). Search covers all tabs.
- **⟳ button on each widget**, for the logged-in admin: fresh data, without the cache. An agent answers immediately, and the Updates widget restarts the search on each machine.
- **Bookmarks**: a category can be shown as compact links (icon and name, or icons only), with no status or notifications, for documentation, your router and so on. Search finds them too.
- **Choose numbers and color thresholds**: in the form of a widget with number blocks, check the ones to show and pick the value at which they turn orange or red.
- **Appearance**: accent color and background image (address or uploaded file), with card blur, in Edit mode > Display.
- **Installable app**: "Add to Home Screen" on a phone opens the dashboard full screen, with its name and icon (Android needs HTTPS for a full install).
- **Widgets in categories**: in edit mode, each widget has a menu to place it in a category, below its tiles. It then follows its tab and collapses with it.
- **Collapsible categories**: click their title (the state is remembered in the browser, or they can be collapsed by default), with an optional icon.
- **Updates**: a "7 updates pending" badge, clickable for the details per machine: apt packages (including security ones) and Docker images whose tag has changed. For the dashboard server and each machine with an agent. Display only, nothing is installed. Visitors who are not logged in only see the numbers; see [agent/README.md](../agent/README.md#mises-à-jour-en-attente) (in French).
- **Agent** for machines behind NAT or without an open port: a small script (Node.js, no dependency) pushes CPU, memory, disks and temperature to the dashboard itself; see [agent/README.md](../agent/README.md) (in French).
- **Notifications** to ntfy, Gotify, Discord or a webhook when an app goes down and when it comes back: the server checks every minute, even with the dashboard closed. With a widget's "Alert me" box, also for what it monitors: stopped Proxmox VM, container or node, disk over 90% (Proxmox, Glances, Agent), Glances or Agent machine offline, Nginx Proxy Manager certificate expiring within 7 days, Uptime Kuma monitor down, Frigate camera off.
- **Backup**: export the configuration to a file (with or without API keys), and import it to restore it or copy it to another machine.

Stack: Node.js + Express on the server, HTML / CSS / JS with no build step on the client. The configuration is stored in `data/config.json`.

## Installation details

### Docker

The image is published at `ghcr.io/circule-studio/server-dashboard`. `.env` must never be published: don't put a password directly in `compose.yaml`. The configuration stays in `./data` across updates.

**From the source code** (development): clone the repository, replace the `image:` line of `compose.yaml` with `build: .`, then run `docker compose up -d --build`.

### Without Docker

The script installs Node.js 22 if needed, downloads the latest release to `/opt/server-dashboard`, creates a `server-dashboard` system user and a systemd service of the same name, and prints a generated admin password once.

| What | Where |
|---|---|
| Settings (password, port, `REQUIRE_LOGIN`…) | `/etc/server-dashboard/server-dashboard.env`, then `sudo systemctl restart server-dashboard` |
| Dashboard config (tiles, widgets) | `/var/lib/server-dashboard/` |
| Logs | `journalctl -u server-dashboard -f` |

- **Update**: run the same command again. The config and settings are kept.
- **Choose a version, a port or a password** on first install: `… | sudo SD_VERSION=v0.1.0 SD_PORT=8080 SD_ADMIN_PASSWORD=… bash`
- **Uninstall**: `… | sudo bash -s -- --uninstall` (add `--purge` to erase the config too).
- **Docker panel**: if Docker is installed on the machine, the service is added to the `docker` group. Otherwise, the panel is simply hidden.

## Several disks

In edit mode, the **Disks** button lists the disks found on the machine (`C:\`, `D:\`… on Windows, real partitions such as `/` or `/mnt/data` on Linux). Check the ones to show and give them a name ("Movies", "Backups"…): each gets its own card in the stats. You can also type a path by hand (mounted network share, folder…).

**With Docker**, the container only sees what is mounted. `compose.yaml` already mounts the host root read-only (`/:/host:ro`): the host's other disks appear under `/host/…` (for example `/host/mnt/data`). A disk mounted elsewhere can be added explicitly:

```yaml
    volumes:
      - /srv/movies:/host/srv/movies:ro
```

**In a Proxmox LXC container**, the dashboard only sees the container's disk: use the Proxmox VE widget instead for the host's storage.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `7575` | HTTP port |
| `ADMIN_PASSWORD` | `admin` | Edit-mode password |
| `DATA_DIR` | `./data` | Config and session secret folder |
| `SERVER_NAME` | machine name | Name shown next to the title (useful with Docker) |
| `DISK_PATH` | `/` (`C:\` on Windows) | Disk shown by default, until disks are chosen in edit mode |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker API socket |
| `REQUIRE_LOGIN` | `false` | `true`: the whole dashboard, reading included, requires logging in |
| `TRUST_PROXY` | – | Behind a reverse proxy, set to `1` so login rate limiting sees real client IPs |
| `SESSION_SECRET` | generated in `data/.secret` | Session cookie signing key |
| `NOTIFY_INTERVAL_MS` | `60000` | Interval between app checks for notifications (in milliseconds) |
| `UPDATE_CHECK` | `true` | `false`: don't check GitHub for a new version (the installed version is still shown to the admin) |

## Security

- Login attempts are limited to 10 per IP every 15 minutes. Changing `ADMIN_PASSWORD` logs out every open session.
- By default, the dashboard can be read without logging in (only editing is protected). If you expose it outside your network, set `REQUIRE_LOGIN=true`.
- Mounting `/var/run/docker.sock` gives the container root-equivalent access to the host. Docker actions require logging in, but don't expose the dashboard directly to the internet: put it behind an HTTPS reverse proxy (Nginx Proxy Manager, Caddy, Traefik) or a VPN (WireGuard, Tailscale).
- For a read-only Docker panel, use a socket proxy such as `tecnativa/docker-socket-proxy` and point `DOCKER_SOCKET` at it (or simply remove the volume).
- API keys and passwords stay on the server: they are never sent to the browser.

## API

Main routes. "–" means public, unless `REQUIRE_LOGIN=true`.

| Method | Route | Login |
|---|---|---|
| GET | `/api/config` | – |
| PUT | `/api/config` | ✔ |
| GET | `/api/config/export` | ✔ |
| GET | `/api/status` | – |
| GET | `/api/system` | – |
| GET | `/api/links` | – |
| GET | `/api/widgets/:id` | – |
| POST | `/api/widgets/:id/refresh` | ✔ |
| GET | `/api/docker/containers` | – |
| POST | `/api/docker/containers/:id/(start\|stop\|restart)` | ✔ |
| GET | `/api/background` | – |
| POST | `/api/background` | ✔ |
| POST | `/api/notify/test` | ✔ |
| GET | `/api/version` | ✔ |
| POST | `/api/login`, `/api/logout` · GET `/api/me` | – |

## Local development

```bash
npm install
npm run dev
```

Then open http://localhost:7575. The password is the one in your `.env` file if it exists (mind the capitals), otherwise `admin`.

To work on widgets without the real services, start a fake service for each widget (Jellyfin, Plex, Proxmox, Home Assistant, GitHub…) and a fake Docker in a second terminal:

```bash
npm run mocks
```

The URLs and test keys to enter are at the top of [dev/mocks.js](../dev/mocks.js).
