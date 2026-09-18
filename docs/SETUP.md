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

### D0. Automatic (CI) — the normal path

`.github/workflows/build.yml` has a `deploy` job that runs after a successful
build and rsyncs every installer straight to `/var/www/updates/launcher/` on
the update server. It only fires for a pushed `v*` tag (a `workflow_dispatch`
run off a branch still just builds artifacts, same as before):

```powershell
git tag v0.2.0
git push origin v0.2.0
```

One-time setup, already done for `ubuntu@130.61.179.91`:

1. A dedicated key pair was generated for CI (not your personal key) and its
   public half appended to the server's `~/.ssh/authorized_keys`.
2. The server's `/var/www/updates/launcher/` needs to be writable by `ubuntu`
   (it's owned by `www-data` from Part A2). Run once on the VPS:
   ```bash
   sudo usermod -aG www-data ubuntu
   sudo chown ubuntu:www-data /var/www/updates/launcher
   sudo chmod -R g+w /var/www/updates/launcher
   sudo chmod g+s /var/www/updates/launcher   # new uploads keep the www-data group
   ```
   Log out/in (or just start a new SSH session) after `usermod` for the group
   change to take effect.

   The `chown` matters beyond just permissions: `ubuntu` recreates every file
   inside this directory on each deploy, so it already owns those and `rsync
   -a` can freely mirror their timestamps/permissions -- but the directory
   entry itself pre-exists and was never recreated by `ubuntu`, and setting
   an explicit (non-"now") mtime or permission bits on a path you don't own
   requires `CAP_FOWNER`, not just group-write. Without this `chown`, the
   build workflow's deploy step needs `--omit-dir-times`/`--no-perms` on its
   rsync call to route around exactly that (see the comment there) -- with
   it, `ubuntu` owns "." too and those workarounds become unnecessary.
3. The private half of the CI key pair needs to be added as a repository
   secret named `DEPLOY_SSH_KEY`: GitHub repo → **Settings → Secrets and
   variables → Actions → New repository secret**. Paste the *private* key
   file's contents (the one **without** `.pub`) as the value.

Steps D1/D2 below are the manual fallback — still useful for a one-off build,
or if you'd rather not wire up CI secrets.

### D1. Build

```powershell
npm run dist:win
```

> **Known snag:** electron-builder always tries to fetch macOS code-signing tools even for a Windows build, and extracting that archive needs a Windows privilege (`SeCreateSymbolicLinkPrivilege`) that a non-admin/non-Dev-Mode session doesn't have — you'll see `Cannot create symbolic link` errors. Fixes: enable **Settings → Privacy & Security → For developers → Developer Mode**, or run the build as Administrator, or build via a CI runner (e.g. GitHub Actions' `windows-latest`, which has this by default). The packaged app itself (`dist\win-unpacked\`) still gets built successfully before this step — only the NSIS installer wrapper needs the fix.

### D2. Upload

Upload everything under `dist\` (the installer `.exe` + `latest.yml`) to `/var/www/updates/launcher/` the same way as part C. Existing installs then pick up the update automatically via electron-updater.

### D3. Other OSes (macOS / Linux)

`npm run dist:mac` and `npm run dist:linux` exist in `package.json`, and `electron-builder.yml` has `mac:`/`linux:` blocks (dmg for Intel+Apple Silicon, AppImage for Linux x64). The catch: **electron-builder builds for the OS it's running on** — you can't produce a `.dmg` from Windows. Options:

- **GitHub Actions** (`.github/workflows/build.yml`, already in the repo): a workflow_dispatch-triggered matrix build that runs each `dist:*` script on its native runner (`windows-latest`/`macos-latest`/`ubuntu-latest`) and uploads the installers as build artifacts. Trigger it from the repo's Actions tab, or by pushing a `v*` tag. No secrets needed for this — it just builds, doesn't publish.
- Alternatively, build on an actual Mac/Linux machine you have access to.

Either way, once you have the `.dmg`/`.AppImage` + their `latest-mac.yml`/`latest-linux.yml`, upload them to `/var/www/updates/launcher/` alongside the Windows files — electron-updater picks the right metadata file per OS automatically from the same URL.

Neither is code-signed (macOS Gatekeeper will warn on first open; that needs an Apple Developer account, out of scope for now).

### D4. The public downloads page

The above publishes to `updates.*` for electron-updater's in-app self-update check. Publishing the
same installers to the human-facing download buttons on ucucraft.fun is a separate job
(`publish-downloads` in the same workflow) — see [PUBLISHING.md](PUBLISHING.md) for that contract.

---

## Testing checklist

- [ ] `curl https://updates.yourdomain.com/modpack/manifest.json` returns real JSON
- [ ] Launcher's "Modpack" status shows a version instead of a connection error
- [ ] Offline login → Play → mods actually appear under the instance's `mods/` folder after first launch
- [ ] Microsoft login opens the sign-in popup instead of "not configured yet"
- [ ] Your main website still loads normally (confirms the nginx change was additive, not disruptive)
- [ ] Sidebar "Reinstall" shows non-zero sizes after a first launch, and a wipe → Play re-downloads cleanly

## Repairing a broken install

Everything below lives in the **Settings** dialog — the gear in the title bar,
which also holds the language toggle and the memory slider.

The launcher verifies every download against a published hash, so a corrupt
file normally repairs itself on the next launch. When something survives that
anyway — a half-written JRE, a mod folder edited by hand — **Reinstall**
deletes the launcher's own downloaded content so the next Play fetches it
again. Three independently selectable groups:

| Group | What it deletes |
| --- | --- |
| Game files | the whole `content/` cache (downloads, jars, libraries, assets, meta) and the instance's `natives/` |
| Java runtime | the bundled Temurin JRE under `jre/` |
| Modpack files | only the folders the manifest owns (`mods/`, `config/`, `coremods/`, `datapacks/`, `discpack/`, `resourcepacks/`) |

**Player data is never in scope.** Worlds, `options.txt`, `servers_new.dat` and
`screenshots/` sit directly in the instance's `minecraft/` dir and no target
resolves to that directory or to anything above it. A reinstall is refused
while the game is running or a launch is mid-download.

### Why the cache is called `content/`, not `cache/`

Electron reserves `userData/Cache` for Chromium's own HTTP cache. On Windows and
macOS the filesystem is case-insensitive, so an innocuous-looking
`userData/cache` is *the same directory* — and the launcher's jars, libraries
and assets ended up sitting next to Chromium's `Cache_Data`, in a folder
Chromium owns and is free to evict, truncate or clear at any time.

That produced downloads which verified correctly in flight and were then
silently rewritten on disk, surfacing much later as unzip failures on files
that had been fine when written (`invalid block type`, `unexpected end of
file`). `paths.cacheRoot()` is therefore `userData/content`, well clear of
anything Electron claims. On startup `maintenance.purgeLegacyCache()` deletes
the launcher's old subdirectories from the shared location — and only those,
never `Cache_Data`.

Two consequences worth preserving if you touch `src/main/launcher/downloader.js`:
a download is verified **by reading the finished file back from disk**, not just
by hashing the network stream (hashing the stream proves the transfer, not the
write), and a failed verification retries up to three times.

## Moving the installation to another drive

Settings → **Installation folder** → Change. The launcher creates a
`BTU Launcher` folder inside whatever directory is picked and moves `content/`,
`instances/` and `jre/` into it, recording the choice as `dataDir` in the
settings file. The settings file itself always stays in `userData` — it's what
records the pointer, so it can't live at the end of it.

The move copies everything and verifies each directory's size before deleting a
single original, so an interrupted move cannot lose a world. It is refused
while the game is running or a launch is mid-download, and refused if the
chosen folder is inside the current one.

### If a download reports "corrupted on write"

This means the bytes arrived over the network correctly (the stream hash
matched) but what landed on disk did not, on three consecutive attempts. The
launcher discards it rather than caching a broken file, which is the intended
behaviour — but the cause is environmental, not a launcher bug. The first thing
to try is excluding the data directory from real-time antivirus scanning
(Windows Security → Virus & threat protection → Exclusions), since on-access
scanners are the usual explanation for a file changing between write and read.

## Known gaps / follow-ups

- ~~**Server not pre-added to the multiplayer list.**~~ Done: `src/main/launcher/serverList.js` writes the `serverAddress` config value into `<gameDir>/servers_new.dat` (gzipped NBT, in this client's own UUID-keyed `ServerData`/`History`/`Favorites` format — not vanilla's flat `servers.dat` list) the first time an instance's game dir is prepared, in `gameLauncher.js`'s `ensureInstanceFiles()`. It only ever creates that file — if it already exists (including a fresh one Minecraft itself just wrote), the player's own list is left untouched.
- ~~**No icon set.**~~ Done: `image.png` is converted to `resources/icon.ico` / `.icns` / `.png` and wired into `electron-builder.yml`.
- **macOS.** Auth and update flows are already OS-agnostic; the gaps are `src/main/launcher/java.js`'s macOS JRE archive layout (Adoptium's macOS zips nest under `Contents/Home`) and an electron-builder `mac:` block.
