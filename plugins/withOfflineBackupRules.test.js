/* global describe, it, expect, __dirname */
// Plain-JS test like withCarPlay.test.js, so no-undef needs the jest globals named.
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  withOfflineBackupRules, addOfflineExcludes, secureStoreRules, OFFLINE_EXCLUDE, BACKUP_RULES, EXTRACTION_RULES,
} = require("./withOfflineBackupRules");

// The rule files the manifest references, read from the installed
// expo-secure-store - exactly what the build merges.
const projectRoot = path.join(__dirname, "..");
const pkgDir = path.dirname(require.resolve("expo-secure-store/package.json", { paths: [projectRoot] }));
const REAL_BACKUP = fs.readFileSync(path.join(pkgDir, "android/src/main/res/xml/secure_store_backup_rules.xml"), "utf8");
const REAL_EXTRACTION = fs.readFileSync(path.join(pkgDir, "android/src/main/res/xml/secure_store_data_extraction_rules.xml"), "utf8");

// Rules with no <include> at all: Android backs up everything but what is excluded.
const NO_INCLUDE_BACKUP = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="sharedpref" path="SecureStore"/>
</full-backup-content>
`;
const NO_INCLUDE_EXTRACTION = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="sharedpref" path="SecureStore"/>
  </cloud-backup>
  <device-transfer>
    <exclude domain="sharedpref" path="SecureStore"/>
  </device-transfer>
</data-extraction-rules>
`;
// A file-domain include that covers offline/.
const FILE_INCLUDE_BACKUP = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <include domain="file" path="."/>
</full-backup-content>
`;

const count = (s, sub) => s.split(sub).length - 1;

function baseConfig() {
  return { name: "dosya", slug: "dosya", android: { package: "dev.dosya" } };
}

function manifestWith(attrs) {
  return { manifest: { application: [{ $: { "android:name": ".MainApplication", ...attrs } }] } };
}

async function runDangerous() {
  const config = withOfflineBackupRules(baseConfig());
  const platformProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "offline-backup-plugin-"));
  await config.mods.android.dangerous({
    ...config,
    modResults: {},
    modRequest: { platformProjectRoot, projectRoot, platform: "android" },
  });
  return path.join(platformProjectRoot, "app", "src", "main", "res", "xml");
}

describe("withOfflineBackupRules", () => {
  it("reads the real expo-secure-store rules, which include only sharedpref", () => {
    expect(secureStoreRules("secure_store_backup_rules.xml", projectRoot)).toBe(REAL_BACKUP);
    expect(REAL_BACKUP).toContain('<include domain="sharedpref" path="."/>');
    expect(REAL_EXTRACTION).toContain('<include domain="sharedpref" path="."/>');
  });

  it("leaves expo-secure-store's rules untouched: their includes already keep offline/ out", () => {
    // An exclude outside every include fails lint's FullBackupContent (fatal in lintVitalRelease).
    expect(addOfflineExcludes(REAL_BACKUP)).toBe(REAL_BACKUP);
    expect(addOfflineExcludes(REAL_EXTRACTION)).toBe(REAL_EXTRACTION);
  });

  it("with the real rules, writes no override files at all", async () => {
    const xmlDir = await runDangerous();
    expect(fs.existsSync(path.join(xmlDir, "secure_store_backup_rules.xml"))).toBe(false);
    expect(fs.existsSync(path.join(xmlDir, "secure_store_data_extraction_rules.xml"))).toBe(false);
  });

  it("adds the exclude to full-backup-content when there is no include", () => {
    const out = addOfflineExcludes(NO_INCLUDE_BACKUP);
    expect(count(out, OFFLINE_EXCLUDE)).toBe(1);
    expect(out.indexOf(OFFLINE_EXCLUDE)).toBeLessThan(out.indexOf("</full-backup-content>"));
    expect(out).toContain('<exclude domain="sharedpref" path="SecureStore"/>');
  });

  it("adds it to both cloud-backup and device-transfer when they have no include", () => {
    const out = addOfflineExcludes(NO_INCLUDE_EXTRACTION);
    const cloud = out.slice(out.indexOf("<cloud-backup>"), out.indexOf("</cloud-backup>"));
    const transfer = out.slice(out.indexOf("<device-transfer>"), out.indexOf("</device-transfer>"));
    expect(cloud).toContain(OFFLINE_EXCLUDE);
    expect(transfer).toContain(OFFLINE_EXCLUDE);
  });

  it("adds it where a file-domain include covers offline/", () => {
    expect(count(addOfflineExcludes(FILE_INCLUDE_BACKUP), OFFLINE_EXCLUDE)).toBe(1);
  });

  it("is idempotent", () => {
    const once = addOfflineExcludes(NO_INCLUDE_EXTRACTION);
    expect(addOfflineExcludes(once)).toBe(once);
  });

  it("leaves the manifest pointing at the secure-store rules after that plugin ran", async () => {
    const config = withOfflineBackupRules(baseConfig());
    const result = await config.mods.android.manifest({
      ...config,
      modResults: manifestWith({ "android:fullBackupContent": BACKUP_RULES, "android:dataExtractionRules": EXTRACTION_RULES }),
      modRequest: { platform: "android" },
    });
    const app = result.modResults.manifest.application[0].$;
    expect(app["android:fullBackupContent"]).toBe(BACKUP_RULES);
    expect(app["android:dataExtractionRules"]).toBe(EXTRACTION_RULES);
  });

  it("points a manifest with no rules at them", async () => {
    const config = withOfflineBackupRules(baseConfig());
    const result = await config.mods.android.manifest({
      ...config,
      modResults: manifestWith({}),
      modRequest: { platform: "android" },
    });
    const app = result.modResults.manifest.application[0].$;
    expect(app["android:fullBackupContent"]).toBe(BACKUP_RULES);
    expect(app["android:dataExtractionRules"]).toBe(EXTRACTION_RULES);
  });

  it("is registered in app.config.ts after expo-secure-store", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "app.config.ts"), "utf8");
    const secure = src.indexOf('"expo-secure-store"');
    const ours = src.indexOf('"./plugins/withOfflineBackupRules"');
    expect(secure).toBeGreaterThan(-1);
    expect(ours).toBeGreaterThan(secure);
  });
});
