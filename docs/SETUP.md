# Setup: step by step

Two halves: getting your **VPS** ready to host updates, and configuring the **launcher** to point at everything. Do them in order — the launcher config in part B needs URLs that only exist after part A.

Assumes: you have SSH access to a VPS that already runs nginx for an existing website, and a domain you can add a subdomain to.

---

## Part A — Host (VPS)

### A1. DNS

In your domain registrar's DNS panel, add an **A record**:

```
updates.yourdomain.com  →  <your VPS's IP>
```

(Same IP your main site already uses — one VPS, many subdomains, no conflict; see the "how this doesn't conflict" note at the end.) Give it a few minutes to propagate.

### A2. Directories

SSH into the VPS:

```bash
sudo mkdir -p /var/www/updates/modpack/files /var/www/updates/launcher
sudo chown -R www-data:www-data /var/www/updates
```

### A3. A new nginx site (doesn't touch your existing site's config)

```bash
sudo nano /etc/nginx/sites-available/updates.yourdomain.com
```

```nginx
server {
    listen 80;
    server_name updates.yourdomain.com;

    root /var/www/updates;
    autoindex off;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/updates.yourdomain.com /etc/nginx/sites-enabled/
sudo nginx -t                    # verify config before touching anything live
sudo systemctl reload nginx
```

`nginx -t` catches mistakes before reload — your existing site never goes down from this.

### A4. HTTPS

```bash
# only if certbot isn't already installed:
sudo apt install certbot python3-certbot-nginx

sudo certbot --nginx -d updates.yourdomain.com
```

Certbot edits only `updates.yourdomain.com`'s own config file.

### A5. Verify

```bash
curl https://updates.yourdomain.com/modpack/
```

Should respond (404 is fine — there's no manifest.json yet) rather than time out or connection-refuse. Load your main website too, just to confirm it's unaffected.

### What this does and doesn't expose

- **Downloading is public** — anyone with a file's URL can fetch it. That's the point (it's how players' launchers get updates), same as any CDN.
- **Uploading is impossible through this URL.** nginx here only serves existing files on `GET`/`HEAD` — there's no script, no upload form, no write path. The *only* way files change on the server is you running `scp`/`rsync` over SSH (part C), which needs your SSH key/password.
- `autoindex off` just stops directory browsing (so `/modpack/files/` doesn't list its contents to a casual visitor) — a tidiness thing, not a security boundary.

---

## Part B — Launcher settings

### B1. Node.js (done already)

`npm install` at the repo root if you haven't since the last dependency change.

### B2. Microsoft login: Azure AD app registration

Needed for "Sign in with Microsoft" to work; offline login doesn't need this.

1. https://portal.azure.com → Azure Active Directory → App registrations → New registration.
2. Name: anything (e.g. "BTU Launcher"). Supported account types: **Personal Microsoft accounts only**.
3. Redirect URI: platform **Web**, value `https://login.microsoftonline.com/common/oauth2/nativeclient`.
4. Copy the **Application (client) ID** from the overview page.

### B3. Edit `src/main/config.js`

```js
serverAddress: 'play.yourdomain.com:25565',        // your real Minecraft server
modpackUpdateUrl: 'https://updates.yourdomain.com/modpack/manifest.json',
btaVersion: '8.0.1',                                 // must match src/main/launcher/versions.js
msaClientId: '<the Azure client ID from B2>',
```

### B4. Edit `electron-builder.yml`

```yaml
publish:
  provider: generic
  url: https://updates.yourdomain.com/launcher/
```

This is only used for the launcher's *own* self-update feed (part D2) — separate from the modpack update in B3.

Your server (`server.properties`) should stay `online-mode=false` — Microsoft login is a client-side identity/skin feature here, not something your server validates (see [ARCHITECTURE.md](ARCHITECTURE.md) for why).

---

## Part C — Publish a modpack update

Every time your mods/configs change:

```powershell
node tools\publish-update.js `
  --source "C:\Users\basys\AppData\Roaming\PrismLauncher\instances\bta_fabric_instance_8.0.1\minecraft" `
  --out .\update-staging `
  --base-url https://updates.yourdomain.com/modpack `
  --version 2
```

Bump `--version` each time — that's what the launcher checks to know something changed.

This walks **six** folders from your instance — not just `mods/`:

```
mods/  config/  coremods/  datapacks/  discpack/  resourcepacks/
```

(configs, resource packs, coremods, datapacks, your disc pack are all included automatically). Left alone on purpose: `saves/`, `screenshots/`, `options.txt`, the server list, `shaderpacks/`, `texturepacks/` — those stay player-local.

It also auto-detects removed mods by diffing against the manifest already sitting in `--out` from last time, and lists them so players' installs get cleaned up too.

Upload the result. `scp` ships with Windows already (`C:\Windows\System32\OpenSSH\scp.exe`) — no extra install:

```powershell
scp -r .\update-staging\* youruser@your-vps-ip:/var/www/updates/modpack/
```

You'll need your VPS's SSH username, IP/hostname, and key (`-i path\to\key.pem`) or password. A GUI alternative if you'd rather drag-and-drop: [WinSCP](https://winscp.net) with the same credentials.

Verify:

```bash
curl https://updates.yourdomain.com/modpack/manifest.json
```

---

## Part D — Publish the launcher itself

Separate from the modpack — this only needs doing when the launcher's *code* changes, not its content.

### D1. Build

```powershell
npm run dist:win
```

> **Known snag:** electron-builder always tries to fetch macOS code-signing tools even for a Windows build, and extracting that archive needs a Windows privilege (`SeCreateSymbolicLinkPrivilege`) that a non-admin/non-Dev-Mode session doesn't have — you'll see `Cannot create symbolic link` errors. Fixes: enable **Settings → Privacy & Security → For developers → Developer Mode**, or run the build as Administrator, or build via a CI runner (e.g. GitHub Actions' `windows-latest`, which has this by default). The packaged app itself (`dist\win-unpacked\`) still gets built successfully before this step — only the NSIS installer wrapper needs the fix.

### D2. Upload

Upload everything under `dist\` (the installer `.exe` + `latest.yml`) to `/var/www/updates/launcher/` the same way as part C. Existing installs then pick up the update automatically via electron-updater.

---

## Testing checklist

- [ ] `curl https://updates.yourdomain.com/modpack/manifest.json` returns real JSON
- [ ] Launcher's "Modpack" status shows a version instead of a connection error
- [ ] Offline login → Play → mods actually appear under the instance's `mods/` folder after first launch
- [ ] Microsoft login opens the sign-in popup instead of "not configured yet"
- [ ] Your main website still loads normally (confirms the nginx change was additive, not disruptive)

## Known gaps / follow-ups

- **Server not pre-added to the multiplayer list.** Vanilla b1.7.3 has no "auto-join" launch flag; players add your server once via the in-game Multiplayer screen. A follow-up (writing the server into `servers_new.dat` on first launch) is a small addition to `src/main/launcher/gameLauncher.js` — not done yet.
- **No icon set.** `resources/icon.ico` is referenced but not created.
- **macOS.** Auth and update flows are already OS-agnostic; the gaps are `src/main/launcher/java.js`'s macOS JRE archive layout (Adoptium's macOS zips nest under `Contents/Home`) and an electron-builder `mac:` block.
