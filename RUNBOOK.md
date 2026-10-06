# Light Cycle Runbook

This runbook covers every environment Light Cycle runs in, how to set each one up from scratch, and how to field-test the game on a bicycle. Each step includes the commands and a **check** that confirms it worked.

| # | Environment | Used for | Status |
|---|---|---|---|
| 1 | Laptop | Development, simulated rides | In use |
| 2 | Mapbox | Map tiles, styles, Tilequery (power-up placement) | In use |
| 3 | Cloudflare Workers (Workers Builds) | Remote playtest URL with per-branch previews | In use |
| 4 | Cloudflare Access | Restricting the playtest URL to testers | **To do** |
| 5 | Proxmox LXC dev server | Self-hosted HTTPS origin behind Cloudflare Tunnel, with autodeploy; home of the Socket.io server and MongoDB from Goalpost 2 | In use |
| 6 | Production (post-MVP) | Vercel + Railway + MongoDB Atlas | Planned |

```
                 ┌───────────────────────── Cloudflare ─────────────────────────┐
 Phone (PWA) ──► │ Workers Builds: lightcycle.<subdomain>.workers.dev (+ previews)│
     │           │ Tunnel: <dev-hostname> ──► cloudflared (outbound only)        │
     │           └───────────────────────────────────────┬───────────────────────┘
     │                                                   ▼
     │                         Proxmox ▸ LXC (Debian/Ubuntu, static LAN IP)
     │                           Nginx :80 ─ /           → client/dist
     │                                     ─ /api, /socket.io → PM2 → Node :3001   (Goalpost 2)
     │                           MongoDB :27017 (localhost only)                   (Goalpost 2)
     │                           cron */5 → deploy.sh (git fetch → build → restart)
     └──► Mapbox: tiles, styles, Tilequery (public pk. token)
          Map Matching (secret sk. token, server-side only)                        (Goalpost 3)
```

---

## 1. Local development

### 1.1 Toolchain

| Tool | Version | Why it's pinned |
|---|---|---|
| Node | 24 LTS (`.nvmrc`) | Vite 8 bundles with rolldown, which fails on older Node with `node:util does not provide an export named 'styleText'` |
| npm | 11 | Workspaces drive the monorepo; `engines` requires it |

```bash
nvm install && nvm use
npm install                      # root + client workspace
cp client/.env.example client/.env
```

`.npmrc` sets `engine-strict=true`, so a wrong Node or npm version gives a clear install error rather than an obscure failure at runtime. `npm run dev` and `npm run preview` go through `scripts/with-node.sh`, which switches to the pinned Node first. This matters because editors often launch with an older Node on `PATH`.

### 1.2 Run

```bash
npm run dev          # http://localhost:5173, also exposed on your LAN IP
npm run typecheck
npm run build        # tsc -b && vite build → client/dist
npm run preview      # serve the production build
npm run icons        # regenerate the PNG icon set (zero dependencies)
```

The game also runs **without a Mapbox token**, on a blank grid. You can work on GPS and collision logic before setting up Mapbox; you just won't see streets.

### 1.3 Simulated rides

Every Goalpost 1 behaviour is verified by feeding a simulated ride into the browser. Replace `navigator.geolocation.watchPosition` with a scripted sequence of fixes, then run it against both `npm run dev` **and** `npm run preview`, because the production build strips the dev-only store handle. Chrome DevTools → **Sensors** is fine for a single fixed position. It can't simulate movement.

**Check:** crossing your own trail eliminates you; riding back down your own street 5 m away doesn't; every power-up node lands on a rideable way.

### 1.4 Known dev-only failure

If the dev server can't resolve `react` imported by `zustand`, npm has left `react` unhoisted in `client/node_modules` while `zustand` sits at the root. Clearing the Vite cache doesn't fix it:

```bash
rm -rf node_modules client/node_modules package-lock.json && npm install
```

Production builds are unaffected.

---

## 2. Mapbox

Create **separate tokens for separate risks**:

| Token | Scopes | URL restriction | Lives in |
|---|---|---|---|
| Local dev (public `pk.`) | default public scopes | none (restricted tokens block `localhost` unless listed) | `client/.env`, git-ignored |
| Playtest deploy (public `pk.`) | `STYLES:TILES`, `STYLES:READ`, `FONTS:READ` | `<subdomain>.workers.dev`, which also covers every preview hostname, because Mapbox allows subdomains of an allowed URL | Workers Builds variable (encrypted) |
| Server (secret `sk.`), Goalpost 3 | `map-matching:read` | — | `server/.env` only |

```
VITE_MAPBOX_PUBLIC_TOKEN=pk.…
```

The client **refuses a token starting with `sk.`** and says why, so a secret key pasted into `client/.env` fails loudly instead of ending up in a public bundle.

**Check:** after a deploy, the style request and the Tilequery request both return 200 from the deployed origin. That proves the URL restriction doesn't break power-up placement.

The free tier includes 100,000 Map Matching requests per month, which is plenty for small-group MVP testing. Watch usage in the Mapbox dashboard.

---

## 3. Remote playtest hosting: Cloudflare Workers Builds

This is an **assets-only Worker** that serves `client/dist` from the origin root, as the PWA requires: `sw.js`, `manifest.json` and `start_url` are all absolute paths. `wrangler.jsonc` deliberately has no `main`.

### 3.1 Connect the repository

Go to **Compute → Workers & Pages → Create → Import a repository**, pick this GitHub repo, and set the following under **Settings → Build**:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler@4 deploy` |
| Non-production branch deploy command | `npx wrangler@4 versions upload` |
| Root directory | `/` |
| Build variables | `NODE_VERSION=24.19.0`, `VITE_MAPBOX_PUBLIC_TOKEN` (**encrypted**) |

Some of these values matter more than they look:

- **`wrangler@4` is pinned in both commands.** The builder defaults to Wrangler 3, which predates assets-only Workers and fails with `Missing entry-point`.
- **`NODE_VERSION` must be set explicitly.** With `engine-strict=true`, a builder that defaults to an older Node fails at `npm ci`.
- **No credentials in GitHub.** Cloudflare creates and holds its own API token for Workers Builds, so no Cloudflare credentials go into GitHub secrets.

### 3.2 Behaviour

- A push to `main` builds and deploys to `https://lightcycle.<subdomain>.workers.dev`.
- A push to any other branch uploads a version and publishes a **preview URL**.
- **GitHub Actions** (`.github/workflows/ci.yml`) runs typecheck and build on branches and PRs, so breakage shows up before it reaches `main`. It doesn't deploy anything.

### 3.3 Caching

`client/public/_headers` controls caching:

| Path | Header | Why |
|---|---|---|
| `/sw.js` | `no-cache, no-store` | A stale service worker would hide every new deploy |
| `/manifest.json` | `max-age=3600` | Name and icon changes show up within the hour |
| `/assets/*` | `max-age=31536000, immutable` | Filenames are content-hashed |

The service worker is **network-first for the app shell** and **cache-first for hashed assets**. It never touches Mapbox tiles. The game needs the network anyway, so it doesn't try to work offline.

**Check:** after a push to `main`, the new build loads on the phone after one reload, with no need to clear site data.

---

## 4. Restrict the playtest URL: Cloudflare Access (to do)

The playtest site is currently public. To lock it to testers:

1. Go to **Zero Trust** and onboard onto the **Free** plan (up to 50 users). Until then, the section only shows a plan chooser.
2. Under **Settings → Authentication**, add **One-time PIN** as the identity provider.
3. Put Access in front of the Worker hostnames. Either:
   - **Worker settings** (simplest): go to **Workers & Pages → lightcycle → Settings → Domains & Routes**, and enable Cloudflare Access on the `workers.dev` route and on **Preview URLs**. This creates the Access applications for you.
   - **Custom domain:** attach a hostname on your own zone to the Worker, then add it under **Access → Applications → Add → Self-hosted**.
4. Configure the application:
   - **Session duration:** 1 month, so riders aren't asked to sign in again mid-ride.
   - **Policy:** Allow → Emails → the tester list.

**Check:** a private window shows the Access PIN prompt. After signing in, the PWA installs and the service worker registers.

---

## 5. Proxmox dev server

This is a self-hosted origin with a stable public HTTPS URL. It exists because:

- The Geolocation API refuses insecure origins, so a phone needs HTTPS.
- From Goalpost 2, the game needs a long-lived Node + Socket.io process and MongoDB, which Workers can't host.

At Goalpost 1 the server serves only the static client build. The PM2, Node and MongoDB parts are set up now so that Goalpost 2 only needs deploying.

### 5.1 Create the container

In Proxmox: **Create CT**:

| Setting | Value |
|---|---|
| Template | Debian 12 or Ubuntu 24.04 |
| Resources | 2 vCPU, 2–4 GB RAM, 16 GB disk |
| Unprivileged | Yes |
| Network | **Static** IPv4 on the LAN (or a DHCP reservation) |
| Features | `nesting=1` (systemd services inside the CT) |

```bash
pct start <CTID> && pct enter <CTID>
apt update && apt full-upgrade -y
apt install -y curl git nginx ca-certificates gnupg
adduser --disabled-password --gecos "" lightcycle    # runs the app, PM2 and the cron
```

### 5.2 Node, PM2 and MongoDB

```bash
# Node 24 via nvm, as the app user
su - lightcycle -c 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash'
su - lightcycle -c 'source ~/.nvm/nvm.sh && nvm install 24 && npm i -g npm@11 pm2'

# MongoDB 7 (Goalpost 2+). Install from the official MongoDB apt repository for your distro, then:
systemctl enable --now mongod
```

MongoDB binds to `127.0.0.1` only (`/etc/mongod.conf` → `net.bindIp`). Nothing outside the container talks to it.

From Goalpost 2, create the indexes once. They're specified in [docs/schema.md](docs/schema.md):

```js
// mongosh
use lightcycle
db.tail_entries.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
db.tail_entries.createIndex({ lobbyId: 1, playerUUID: 1 })
db.tail_entries.createIndex({ intersectionNodes: 1 })
db.lobbies.createIndex({ inviteCode: 1 }, { unique: true })
db.lobbies.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 })
db.player_sessions.createIndex({ uuid: 1 }, { unique: true })
db.player_sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 })
```

The TTL index on `tail_entries.expiresAt` is what expires tails. The application never cleans them up itself.

### 5.3 Clone and build

```bash
mkdir -p /var/www && chown lightcycle: /var/www
su - lightcycle
git clone <repo-url> /var/www/light-cycle && cd /var/www/light-cycle
nvm use && npm ci
cp client/.env.example client/.env     # set VITE_MAPBOX_PUBLIC_TOKEN
npm run build                          # → client/dist
```

For a private repository, add a **read-only deploy key** to the container rather than a personal token.

### 5.4 Nginx

TLS ends at Cloudflare's edge, and the tunnel carries traffic to the container over an encrypted outbound connection. So Nginx listens on **localhost:80** and needs no certificate of its own.

`/etc/nginx/sites-available/light-cycle`:

```nginx
server {
    listen 127.0.0.1:80;
    server_name _;

    root /var/www/light-cycle/client/dist;
    index index.html;

    # Same caching rules as client/public/_headers
    location = /sw.js         { add_header Cache-Control "no-cache, no-store, must-revalidate"; }
    location = /manifest.json { add_header Cache-Control "public, max-age=3600"; }
    location /assets/         { add_header Cache-Control "public, max-age=31536000, immutable"; }

    location / { try_files $uri $uri/ /index.html; }

    # Goalpost 2+: Express API and Socket.io on :3001
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;    # keep long-lived WebSockets open
    }
}
```

```bash
ln -s /etc/nginx/sites-available/light-cycle /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
curl -sI http://127.0.0.1/ | head -1        # HTTP/1.1 200 OK
```

> **Why not Certbot?** The original plan put Let's Encrypt on Nginx as well. Behind a tunnel, nothing reaches port 80 from outside, so the HTTP-01 challenge can't complete. You'd need DNS-01 with a Cloudflare API token, and that buys nothing, because the hop from tunnel to Nginx stays inside the container. If you do want TLS on the origin, use a **Cloudflare Origin CA** certificate on `:443` and point the tunnel at `https://localhost:443` with `originServerName` set.

### 5.5 Cloudflare Tunnel

1. Go to **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, and name it (e.g. `light-cycle-dev`).
2. Copy the connector install command and run it **inside the container**:

   ```bash
   curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
   echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
   apt update && apt install -y cloudflared
   cloudflared service install <TUNNEL_TOKEN>
   systemctl status cloudflared
   ```

3. Under the tunnel's **Public Hostname** tab, add `<dev-hostname>` (a hostname on a zone in your account) → Service `HTTP` → `localhost:80`.

The tunnel only makes **outbound** connections. You don't open any router ports, and your home IP never appears in DNS.

**Check:** `curl -sI https://<dev-hostname>/` returns 200 from your laptop on cellular, and the game asks for location permission on a phone.

To lock the dev hostname down too, add it as another self-hosted Access application, the same way as step 4.

### 5.6 PM2 (Goalpost 2+)

`ecosystem.config.cjs` at the repo root:

```js
module.exports = {
  apps: [{
    name: 'light-cycle-server',
    script: './server/dist/index.js',
    env: { NODE_ENV: 'production', PORT: 3001 },
    watch: false,
    restart_delay: 3000,
    max_restarts: 5,
  }],
};
```

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u lightcycle --hp /home/lightcycle   # run the command it prints, as root
```

`server/.env` (git-ignored):

```
PORT=3001
MONGODB_URI=mongodb://127.0.0.1:27017/lightcycle
MAPBOX_API_TOKEN=sk.…          # secret, server only
CORS_ORIGIN=https://<dev-hostname>
NODE_ENV=production
```

### 5.7 Autodeploy cron

`/var/www/light-cycle/scripts/deploy.sh`. It's kept outside git or listed in `.git/info/exclude`, so `git pull` never conflicts with it:

```bash
#!/usr/bin/env bash
# Poll main; rebuild and restart only when it moved. Runs every 5 minutes.
set -euo pipefail
cd /var/www/light-cycle
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use >/dev/null

exec 9>/tmp/light-cycle-deploy.lock
flock -n 9 || exit 0                       # a slow build must not overlap the next tick

git fetch --quiet origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0

git reset --hard origin/main               # the server never carries local edits
npm ci
npm run build                              # client → client/dist (Nginx serves it directly)
if [ -d server ]; then                     # Goalpost 2+
  npm run build -w server
  pm2 restart light-cycle-server
fi
echo "Deployed $(git rev-parse --short HEAD) at $(date -Is)"
```

```bash
chmod +x scripts/deploy.sh
crontab -e    # as lightcycle
*/5 * * * * /var/www/light-cycle/scripts/deploy.sh >> /var/log/light-cycle/deploy.log 2>&1
```

Create `/var/log/light-cycle/` owned by `lightcycle`, and add a `logrotate` rule.

`client/vite.config.ts` splits `mapbox-gl` (~1.8 MB) into its own long-cached chunk. Each deploy cycle then only re-downloads the app code, which matters when testers are on cellular.

**Check:** push a trivial change to `main`. Within 5 minutes `deploy.log` shows `Deployed <sha>`, and the phone picks up the change after one reload.

### 5.8 Proxmox housekeeping

- **Backups:** **Datacenter → Backup** → nightly `vzdump` of the CT, in snapshot mode. MongoDB data is short-lived by design (TTL indexes), so the container's config is what's worth backing up.
- **Snapshots:** take one before OS upgrades: `pct snapshot <CTID> pre-upgrade`.
- **Logs:** `journalctl -u cloudflared`, `pm2 logs`, `/var/log/nginx/`, and `deploy.log`.

---

## 6. Field testing on a bicycle

This is what closes Goalpost 1.

1. Open the playtest URL (step 3) or the dev hostname (step 5) on the phone, and **add it to the home screen**.
2. Start the game, let it get a GPS fix, then set the node count and drag the play-zone corners.
3. Ride. Watch the debug panel for fix rate, accuracy, rejections, smoothing shift and wake-lock status.
4. Afterwards, **export the event log** from the debug panel. It survives a reload and keeps the previous session.
5. Summarise it at a desk:

   ```bash
   node scripts/analyse-ride.mjs ~/Downloads/light-cycle-current-<n>.json
   ```

   This prints fix rate, accuracy percentiles, smoothing shift, rejections by cause, tail growth, the road classes power-ups landed on, zone crossings, collisions and the wake-lock timeline.

6. Tune [`client/src/config/gameConfig.ts`](client/src/config/gameConfig.ts) from the numbers, not from memory. The README's outdoor-test table says which reading drives which setting.

---

## 7. Production target (post-MVP)

| Piece | Host | Notes |
|---|---|---|
| PWA | Vercel (or stay on Workers) | Static build, GitHub push deploy |
| Express + Socket.io | Railway / Render / Fly | Needs a long-lived process; sticky sessions if horizontally scaled |
| Database | MongoDB Atlas | Same indexes as step 5.2 |
| Map matching | Mapbox (secret token) | Server-side only |

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `node:util does not provide an export named 'styleText'` | Node too old for Vite 8 / rolldown | `nvm use`; start dev through `npm run dev` |
| `npm ci` refuses with `EBADENGINE` | `engine-strict` with the wrong Node or npm | Node 24 + npm 11 locally; `NODE_VERSION` in Workers Builds |
| Workers Builds: `Missing entry-point` | The builder used Wrangler 3 | Pin `npx wrangler@4` in both deploy commands |
| Blank grid instead of streets on the deployed site | Token missing from the build, or the URL restriction excludes the hostname | Set the encrypted build variable; allow `<subdomain>.workers.dev` |
| Map loads but game layers are missing | Layers were added before the style was ready | Already handled: layers are added on `style.load`, not `load`. Keep it that way |
| Phone never asks for location | Page is not on HTTPS | Use the tunnel or the Workers URL, not the LAN IP |
| Old build keeps loading after deploy | Stale service worker | `/sw.js` must be served `no-store` (step 3.3 / 5.4) |
| Screen sleeps mid-ride | Wake lock lost on tab hide | Re-acquired on visibility change; the "screen lock not held" pill flags it |
| Tunnel shows `HEALTHY` but the site returns 502 | Nginx not listening on the target | `curl -sI http://127.0.0.1/` inside the CT; check the Public Hostname service URL |
| Autodeploy silently stopped | Cron environment has no nvm on `PATH` | `deploy.sh` sources `nvm.sh` itself; check `deploy.log` |
