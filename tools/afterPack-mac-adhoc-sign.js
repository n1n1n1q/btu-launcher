// electron-builder.yml sets mac.identity to null (no Apple Developer account
// -- see docs/SETUP.md), which makes electron-builder skip macOS code signing
// entirely -- and, as a side effect, its own `afterSign` hook too (see
// app-builder-lib's platformPackager.js: "skipping afterSign hook as no
// signing occurred, perhaps you intended afterPack?"). That's fine on Intel,
// where an unsigned app just gets Gatekeeper's dismissible "unidentified
// developer" warning. On Apple Silicon it's not: the OS refuses to even
// launch a completely unsigned arm64 binary, reporting the unrelated-looking
// "App is damaged and can't be opened" instead. Ad-hoc signing (identity
// "-") satisfies that requirement without needing a real certificate, so
// this runs unconditionally on every mac build via electron-builder's
// `afterPack` hook (which fires regardless of the identity/afterSign skip).
const path = require("path");
const { execFileSync } = require("child_process");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--deep", "--force", "--sign", "-", appPath], { stdio: "inherit" });
};
