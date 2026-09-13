# BTU Launcher

A custom desktop launcher for the BTU server (Better Than Adventure, running on Babric), with
Microsoft and offline ("cracked") login and self-updating modpack content.

- **Setup / deployment steps:** [docs/SETUP.md](docs/SETUP.md)
- **How it works internally:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Quick start (dev)

```
npm install
npm start
```

Requires Node.js (LTS) — see docs/SETUP.md if it's not installed yet.

## Publishing an update

```
node tools/publish-update.js --source <path to a real instance's minecraft folder> --out ./update-staging --base-url https://updates.yourserver.com/modpack
```

then upload `update-staging/` to your server. See docs/SETUP.md §5.

## Building the installer

```
npm run dist:win
```
