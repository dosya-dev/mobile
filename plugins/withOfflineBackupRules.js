/* global __dirname */
const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

// Offline files (src/offline/store.ts) live under <filesDir>/offline/: the
// documents directory, so Android never clears them the way it clears a cache.
// That also makes them eligible for Auto Backup, and a pinned 20 GB folder must
// neither fill the user's Google Drive backup nor travel to a new phone - it is
// a copy of what is on dosya, scoped to an account that may not be signed in
// there. iOS excludes the same directory natively (modules/dosya-media-extras).
//
// android/ is generated (prebuild), so this has to be a config plugin. The
// manifest points at expo-secure-store's two rule files. When a rules section
// has ANY <include>, Android backs up only what is included - so with
// secure-store's rules (sharedpref only) files/offline/ is already excluded and
// this plugin changes nothing. Adding an exclude there would even break the
// release build: lint's FullBackupContent check (fatal in lintVitalRelease)
// rejects an exclude that sits outside every include.
//
// So the exclude goes in only where it is both needed and valid: a section with
// no <include> at all (everything is backed up), or one whose file-domain
// include covers offline/. Then app-level copies of the same resource names are
// written; app resources override a library's at merge time, keeping
// secure-store's own exclusion. Registered after "expo-secure-store".

const BACKUP_RULES = "@xml/secure_store_backup_rules";
const EXTRACTION_RULES = "@xml/secure_store_data_extraction_rules";
const OFFLINE_EXCLUDE = '<exclude domain="file" path="offline/"/>';

// expo-secure-store 15's files, used only if its package cannot be read at
// prebuild time. Reading the package keeps us in step if a later version
// changes its own rules.
const FALLBACK = {
  "secure_store_backup_rules.xml": `<?xml version="1.0" encoding="utf-8"?>

<!--  Auto Backup configuration for Android 11 and lower -->
<full-backup-content>
  <include domain="sharedpref" path="."/>
  <exclude domain="sharedpref" path="SecureStore"/>
</full-backup-content>
`,
  "secure_store_data_extraction_rules.xml": `<?xml version="1.0" encoding="utf-8"?>

<!--  Auto Backup configuration for Android 12 and higher -->
<data-extraction-rules>
  <cloud-backup>
    <include domain="sharedpref" path="."/>
    <exclude domain="sharedpref" path="SecureStore"/>
  </cloud-backup>
  <device-transfer>
    <include domain="sharedpref" path="."/>
    <exclude domain="sharedpref" path="SecureStore"/>
  </device-transfer>
</data-extraction-rules>
`,
};

/** Whether a section's includes leave offline/ backed up (so an exclude is needed, and lint accepts it). */
function sectionBacksUpOffline(body) {
  const includes = [...body.matchAll(/<include\b[^>]*>/g)].map((m) => m[0]);
  if (includes.length === 0) return true;
  return includes.some((inc) => {
    if (!/domain="file"/.test(inc)) return false;
    const p = (/path="([^"]*)"/.exec(inc) || [])[1] || "";
    return p === "." || p === "" || p === "offline" || p === "offline/";
  });
}

/**
 * Insert the offline exclude into each rules section that would otherwise back
 * offline/ up. Sections that already leave it out are not touched. Idempotent.
 */
function addOfflineExcludes(xml) {
  let out = xml;
  for (const tag of ["full-backup-content", "cloud-backup", "device-transfer"]) {
    const close = `</${tag}>`;
    const end = out.indexOf(close);
    if (end === -1) continue;
    const open = out.lastIndexOf(`<${tag}`, end);
    const body = open === -1 ? "" : out.slice(open, end);
    if (body.includes(OFFLINE_EXCLUDE)) continue;
    if (!sectionBacksUpOffline(body)) continue;
    const indent = tag === "full-backup-content" ? "  " : "    ";
    const lineStart = out.lastIndexOf("\n", end) + 1;
    out = `${out.slice(0, lineStart)}${indent}${OFFLINE_EXCLUDE}\n${out.slice(lineStart)}`;
  }
  return out;
}

function secureStoreRules(name, projectRoot) {
  try {
    const pkg = require.resolve("expo-secure-store/package.json", { paths: [projectRoot || process.cwd(), __dirname] });
    return fs.readFileSync(path.join(path.dirname(pkg), "android", "src", "main", "res", "xml", name), "utf8");
  } catch {
    return FALLBACK[name];
  }
}

function withOfflineBackupRules(config) {
  config = withAndroidManifest(config, (config) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    // Only fill in what is missing. A rules file someone else configured on
    // purpose is theirs to extend; overwriting it would drop their exclusions.
    if (!app.$["android:fullBackupContent"]) app.$["android:fullBackupContent"] = BACKUP_RULES;
    if (!app.$["android:dataExtractionRules"]) app.$["android:dataExtractionRules"] = EXTRACTION_RULES;
    if (app.$["android:fullBackupContent"] !== BACKUP_RULES || app.$["android:dataExtractionRules"] !== EXTRACTION_RULES) {
      console.warn("withOfflineBackupRules: the manifest uses other backup rules; add " + OFFLINE_EXCLUDE + " to them by hand.");
    }
    return config;
  });

  config = withDangerousMod(config, ["android", async (config) => {
    const xmlDir = path.join(config.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
    for (const name of Object.keys(FALLBACK)) {
      const source = secureStoreRules(name, config.modRequest.projectRoot);
      const next = addOfflineExcludes(source);
      // Nothing to add: leave secure-store's own resource in charge.
      if (next === source) continue;
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, name), next);
    }
    return config;
  }]);

  return config;
}

module.exports = withOfflineBackupRules;
module.exports.withOfflineBackupRules = withOfflineBackupRules;
module.exports.addOfflineExcludes = addOfflineExcludes;
module.exports.secureStoreRules = secureStoreRules;
module.exports.OFFLINE_EXCLUDE = OFFLINE_EXCLUDE;
module.exports.BACKUP_RULES = BACKUP_RULES;
module.exports.EXTRACTION_RULES = EXTRACTION_RULES;
