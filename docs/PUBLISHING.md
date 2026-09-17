# Publishing launcher builds to the UCUcraft site

This is the contract between the launcher's release CI and the public downloads page at
[ucucraft.fun](https://ucucraft.fun/). The site is **static** — no build step, no API. It reads
one JSON file and turns the four download buttons on.

Implemented by the `publish-downloads` job in
[`.github/workflows/build.yml`](../.github/workflows/build.yml). Everything below is already live
on the site side; nothing there needs to change when you publish a release — the CI job just
uploads files and rewrites one manifest.

This is a separate concern from [SETUP.md Part D](SETUP.md#part-d--publish-the-launcher-itself):
that `deploy` job feeds electron-updater's own in-app self-update check via
`updates.ucucraft.fun`; this one feeds the human-facing download buttons on `ucucraft.fun`. Both
happen to live on the same box (`130.61.179.91`) today, but they're independent jobs with
independent keys.

---

## 1. Where things go

The site is served by nginx from `/home/ubuntu/ucucraft-site/public` on the game host (the same
machine as `mc.ucucraft.fun`). Two paths matter:

| What | Path on server | Public URL |
|---|---|---|
| Binaries | `/home/ubuntu/ucucraft-site/public/downloads/` | `https://ucucraft.fun/downloads/<file>` |
| Manifest | `/home/ubuntu/ucucraft-site/public/data/releases.json` | `https://ucucraft.fun/data/releases.json` |

Both directories are owned directly by the `ubuntu` user (unlike `/var/www/updates/`, which is
`www-data`-owned — no group-write dance needed here). `autoindex` is off for `/downloads/`, so
every file must be linked by its exact name from the manifest.

---

## 2. The manifest: `data/releases.json`

The page fetches this on load (cache-busted, `no-store`). If it's missing, malformed, or a build
key is absent, the corresponding button silently stays in its "Скоро" state — a failed release
never breaks the page.

```json
{
  "version": "0.2.0",
  "released": "2026-09-18T12:00:00Z",
  "builds": {
    "windows-x86_64": {
      "url": "downloads/BTU-Launcher-0.2.0-windows-x86_64.exe",
      "size": 78123456,
      "sha256": "9f2b...c41"
    },
    "macos-arm64": {
      "url": "downloads/BTU-Launcher-0.2.0-macos-arm64.dmg",
      "size": 81234567,
      "sha256": "1a77...0be"
    },
    "macos-x86_64": {
      "url": "downloads/BTU-Launcher-0.2.0-macos-x64.dmg",
      "size": 84234567,
      "sha256": "77cd...9a2"
    },
    "linux-x86_64": {
      "url": "downloads/BTU-Launcher-0.2.0-linux-x86_64.AppImage",
      "size": 92345678,
      "sha256": "b30e...5f1"
    }
  }
}
```

### Field rules

- **The four `builds` keys are fixed strings** the page matches literally
  (`data-build="windows-x86_64"` etc.) — never rename or suffix them.
  - `windows-x86_64` → Windows card
  - `macos-arm64` → macOS card, "Apple Silicon" button
  - `macos-x86_64` → macOS card, "Intel · x86_64" button
  - `linux-x86_64` → Linux card, "AppImage" button
- `url` — relative to the site root, no leading slash.
- `size` — bytes, integer. Omit it and the button just reads "Завантажити" with no size.
- `sha256` — lowercase hex, shown as the button's tooltip.
- `version` / `released` — when present the page shows `ВЕРСІЯ 0.2.0 · ОНОВЛЕНО 18.09.2026`.
  `released` must be ISO-8601.
- `prism` — **not currently automated.** A ready-made Prism Launcher instance zip is a separate
  artifact this repo's build pipeline doesn't produce; publish it by hand under
  `downloads/ucucraft-prism-<version>.zip` and add a `prism` key to the manifest manually if/when
  it's needed. Until then the site's Prism link falls back to `downloads/ucucraft-prism.zip` (its
  own default — nothing to do here unless that link should point somewhere real).

### Why the mac filenames say `x64`, not `x86_64`

`electron-builder.yml`'s `artifactName` templates use its `${arch}` token for the mac target
(needed to tell the Intel and Apple Silicon dmg apart at all), which resolves to `x64`/`arm64` —
there's no `${arch}` value that renders as `x86_64`. The **manifest key** is still the required
literal `macos-x86_64`; only the filename on disk says `x64`. Windows and Linux only ever build one
architecture, so their `artifactName` is a fixed literal ending in `-x86_64` instead, with no
token — nothing to mismatch there.

---

## 3. Ordering — this is the part that matters

The site may fetch the manifest at any instant, including mid-deploy. So the `publish-downloads`
job:

1. Uploads **all** binaries first (`rsync ... dist/ .../downloads/`).
2. Writes the manifest **last**, and **atomically** — uploads to `releases.json.tmp`, then `mv`s it
   into place over SSH. `mv` within the same filesystem is atomic, so a visitor either sees the
   whole old manifest or the whole new one, never a truncated file.

Never write `releases.json` directly with `scp`/`rsync` — a partial file is a broken JSON parse and
all four buttons drop back to "Скоро" until the transfer finishes.

---

## 4. Server access

Deploy over SSH as the `ubuntu` user, using a **dedicated CI-only key** — never a personal one.

One-time setup (already done for the key pair; the public half still needs adding to the server —
see the note below):

```bash
# on the server, as ubuntu
cat >> ~/.ssh/authorized_keys <<< "<the CI public key, comment: ucucraft-launcher-ci>"
```

Repository secrets (GitHub repo → Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `UCUCRAFT_SSH_HOST` | `130.61.179.91` (or `ucucraft.fun` — same box) |
| `UCUCRAFT_SSH_USER` | `ubuntu` |
| `UCUCRAFT_SSH_KEY` | the CI private key, full contents including `-----BEGIN/END-----` |
| `UCUCRAFT_SSH_PORT` | optional; the workflow defaults to `22` if unset |

---

## 5. Triggering

Unlike the original spec this doc is based on (which triggered on a GitHub *Release* being
published), `publish-downloads` runs off the same trigger as the rest of this repo's CI — a pushed
`v*` tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

A `workflow_dispatch` run off a branch still only builds artifacts (both `deploy` and
`publish-downloads` are gated on `startsWith(github.ref, 'refs/tags/v')`).

---

## 6. Verify after a run

```bash
curl -fsS https://ucucraft.fun/data/releases.json | jq .

# every url in the manifest must return 200 and a sane size
curl -fsS https://ucucraft.fun/data/releases.json \
  | jq -r '.builds[].url, (.prism.url // empty)' \
  | while read -r u; do
      printf '%s -> %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code} %{size_download}B' "https://ucucraft.fun/$u")"
    done
```

Then open `https://ucucraft.fun/#play`: all four buttons should be green with a size under the
label, and the version line should read the new version. A button still showing "Скоро" means its
key is missing or misspelled in `builds`.

---

## 7. Housekeeping

- Keep the last 2–3 versions in `downloads/`, delete older ones by hand over SSH — the disk is
  shared with the Minecraft server, and this job never deletes anything on its own.
- No nginx change is ever needed for this. The page requests the manifest with `cache: "no-store"`
  and a cache-buster, so a new manifest is picked up on the next page load.
