# Architecture

## How BTA actually launches (the part that isn't obvious from the mod's site)

BTA (Better Than Adventure) is a "jarmod" on top of vanilla Minecraft Beta 1.7.3, run through
**Babric**, a fork of the Fabric mod loader for Beta 1.7.3. This was reverse-engineered from a
real Prism Launcher instance (`mmc-pack.json` + `patches/*.json`) and cross-checked against BTA's
own official instance-meta repo: https://github.com/Turnip-Labs/bta-fabric-instance-repo (tagged
per release, e.g. `8.0` for BTA v8.0.1).

The four documents that fully describe a launchable instance:

| File | What it gives you |
|---|---|
| `patches/net.minecraft.json` | Vanilla `client.jar` download (from `launcher.mojang.com`), the legacy asset index, `minecraftArguments` template, required Java major (17) |
| `patches/org.lwjgl.json` | LWJGL 3.3.3 libraries + per-OS/arch natives |
| `patches/custom.jarmod.bta.json` | The BTA client jar itself (from `downloads.betterthanadventure.net`) — gets layered over the vanilla jar, BTA's files winning on conflicts |
| `patches/net.fabricmc.fabric-loader.json` | Babric loader jar + its libraries (asm, sponge-mixin), and the real entry point: `net.fabricmc.loader.impl.launch.knot.KnotClient` |

`src/main/launcher/versions.js` maps a BTA version string to the git ref holding these four files;
`src/main/launcher/metaFetch.js` fetches and caches them (immutable per tag, so no re-fetch after
the first time). `src/main/launcher/libraryResolver.js` interprets the library entries generically
(same rule/os-matching schema Mojang's own launcher uses), so nothing about individual libraries
is hardcoded — bumping BTA version is a one-line change in `versions.js`.

## Launch pipeline (`src/main/launcher/gameLauncher.js`)

1. Fetch instance meta (cached).
2. Ensure a Java 17 runtime (`java.js` downloads Eclipse Temurin from Adoptium if none is configured/found — BTA needs Java 17, not the Java 8 you'd expect for something this old).
3. Download + verify vanilla `client.jar` and the BTA jarmod (sha1-checked, shared content-addressed cache under `%APPDATA%/BTU Launcher/cache`).
4. Merge them (`jarmod.js`): BTA's zip entries overwrite vanilla's, cached by the pair of source hashes.
5. Download + verify LWJGL/loader libraries; split natives (`.dll`) from classpath jars; extract natives to a flat per-instance dir (`natives.js`).
6. Legacy assets (`assets.js`): b1.7.3 predates the modern assets system entirely — its launch args don't even take `--assetsDir`. It expects a flat `<gameDir>/resources/` folder of real-named files, so we download Mojang's hash-addressed objects once into the shared cache and copy them out to their real names per instance.
7. Build the JVM command line (`-cp <merged jar + libraries> net.fabricmc.loader.impl.launch.knot.KnotClient <substituted args>`) and spawn it.

## Auth model

- **Offline** (`auth/offline.js`): no network call. Username -> deterministic offline UUID (same scheme vanilla uses: MD5 of `"OfflinePlayer:<name>"` coerced to a v3 UUID). Works because the BTU server runs `online-mode=false` and trusts the claimed username, same as any offline-mode server.
- **Microsoft** (`auth/microsoft.js`): real OAuth via `msmc` (MSA -> Xbox Live -> XSTS -> Minecraft profile), using your own Azure AD app registration (docs/SETUP.md). **The server still doesn't validate this session** — per project decision, BTU stays offline-mode, so Microsoft login is purely a client-side identity feature (real username + real skin) with the same trust level as offline login, not a security boundary. If that ever needs to change, the server would need to flip to `online-mode=true` and implement the Yggdrasil `hasJoined` session-server check; `auth/microsoft.js` already produces a real access token (`profile.accessToken` / the `token:` session string) so that upgrade wouldn't require touching the launcher.

## Modpack updates

`tools/publish-update.js` hashes a real instance's `mods/`, `config/`, `coremods/`, `datapacks/`,
`discpack/`, `resourcepacks/` folders into a `manifest.json` (path + sha1 + size + URL per file),
diffing against the previously-published manifest to compute a `remove` list automatically.
`src/main/updater/modpack.js` applies that manifest client-side: downloads anything new/changed,
deletes anything no longer listed *within those same managed folders only* — saves, screenshots,
options, and the server list are never touched. This is a static-file design on purpose (see
`docs/SETUP.md` §4) — no backend process needed on the VPS, just files served over HTTPS.

Launcher self-updates are a separate, unrelated channel (`electron-updater`, generic provider) —
bumping the modpack never requires shipping a new launcher build, and vice versa.
