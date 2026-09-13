// Maps a BTA version (what config.btaVersion / a modpack manifest points at)
// to the git ref in BTA's own official instance-meta repo. That repo is tagged
// per release and contains everything needed to build & launch the instance
// (vanilla jar location, the BTA jarmod, the Babric loader + its libraries) --
// see docs/ARCHITECTURE.md for how this was reverse-engineered from a real
// Prism/MultiMC instance.
//
// To support a new BTA release: check https://github.com/Turnip-Labs/bta-fabric-instance-repo
// for the new tag and add a line here. No other code changes needed.
const META_REPO = 'Turnip-Labs/bta-fabric-instance-repo';

const KNOWN_VERSIONS = {
  '8.0.1': { ref: '8.0', metaRepo: META_REPO },
};

function resolveRef(btaVersion) {
  const entry = KNOWN_VERSIONS[btaVersion];
  if (!entry) {
    throw new Error(
      `Unknown BTA version "${btaVersion}" -- add it to src/main/launcher/versions.js first.`
    );
  }
  return entry;
}

module.exports = { KNOWN_VERSIONS, resolveRef };
