/* global describe, it, expect */
// eslint-config-expo's flat config doesn't ship Jest env globals for plain .js
// files (every other test file in this repo is .ts, where @types/jest's ambient
// declarations cover it) - this file is the first plain-JS test, so no-undef
// needs an explicit assist. `npm test` (the actual CI gate) is unaffected; this
// only keeps `npx eslint` clean.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withCarPlay } = require("./withCarPlay");
const { CAR_SCENE_DELEGATE_SWIFT } = require("./carPlaySceneDelegates");

// withInfoPlist/withEntitlementsPlist/withDangerousMod/withXcodeProject all run their
// callback immediately against `config.mods.ios.*` in Expo's config-plugin test harness;
// invoking withCarPlay's mods array directly here (rather than a full prebuild) keeps
// this fast and gives a clear diff when a key is wrong.
function baseConfig() {
  return { name: "Dosya", slug: "dosya", ios: { bundleIdentifier: "dev.dosya.app" } };
}

describe("withCarPlay", () => {
  it("adds the CarPlay audio entitlement", async () => {
    const config = withCarPlay(baseConfig());
    const entitlementsMod = config.mods.ios.entitlements;
    const result = await entitlementsMod({ ...config, modResults: {} });
    expect(result.modResults["com.apple.developer.carplay-audio"]).toBe(true);
  });

  it("adds the CarPlay scene manifest alongside the default UIWindowScene", async () => {
    const config = withCarPlay(baseConfig());
    const infoPlistMod = config.mods.ios.infoPlist;
    const result = await infoPlistMod({ ...config, modResults: {} });
    const sceneConfigs = result.modResults.UIApplicationSceneManifest.UISceneConfigurations;
    expect(sceneConfigs.CPTemplateApplicationSceneSessionRoleApplication).toEqual([
      expect.objectContaining({ UISceneClassName: "CPTemplateApplicationScene", UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).CarSceneDelegate" }),
    ]);
    expect(sceneConfigs.UIWindowSceneSessionRoleApplication).toEqual([
      expect.objectContaining({ UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).PhoneSceneDelegate" }),
    ]);
  });

  describe("bridging header", () => {
    // react-native-carplay is an Obj-C-only pod with no generated Swift module,
    // so `import react_native_carplay` in Swift fails with "no such module" and
    // breaks EVERY iOS build. RNCarPlay has to reach Swift via the app target's
    // bridging header instead. Run against a real temp dir rather than a mocked
    // fs, so the append/idempotency behaviour is the real one.
    const PROJECT_NAME = "dosyadev";

    function makeIosTree(bridgingHeaderContents) {
      const platformProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "carplay-plugin-"));
      fs.mkdirSync(path.join(platformProjectRoot, PROJECT_NAME));
      if (bridgingHeaderContents !== null) {
        fs.writeFileSync(
          path.join(platformProjectRoot, PROJECT_NAME, `${PROJECT_NAME}-Bridging-Header.h`),
          bridgingHeaderContents,
        );
      }
      return platformProjectRoot;
    }

    async function runDangerousMods(platformProjectRoot) {
      const config = withCarPlay(baseConfig());
      // withDangerousMod chains: the outermost mod invokes the earlier one, so
      // this single call runs both the bridging-header and scene-file mods.
      await config.mods.ios.dangerous({
        ...config,
        modRequest: { platformProjectRoot, projectName: PROJECT_NAME, platform: "ios" },
        modResults: {},
      });
      return path.join(platformProjectRoot, PROJECT_NAME, `${PROJECT_NAME}-Bridging-Header.h`);
    }

    it("appends the RNCarPlay import to the Expo-generated bridging header", async () => {
      const root = makeIosTree("//\n// Use this file to import your target's public headers.\n//\n");
      const headerPath = await runDangerousMods(root);
      const contents = fs.readFileSync(headerPath, "utf8");
      expect(contents).toContain("#import <react-native-carplay/RNCarPlay.h>");
      // Whatever was already there (Expo's own comment, other plugins' imports)
      // must survive - this appends, it never overwrites.
      expect(contents).toContain("Use this file to import your target's public headers.");
    });

    it("does not double-insert when prebuild runs again", async () => {
      const root = makeIosTree("//\n");
      await runDangerousMods(root);
      const headerPath = await runDangerousMods(root);
      const contents = fs.readFileSync(headerPath, "utf8");
      expect(contents.match(/react-native-carplay\/RNCarPlay\.h/g)).toHaveLength(1);
    });

    it("leaves no Swift `import react_native_carplay` for the pod, which has no module", () => {
      expect(CAR_SCENE_DELEGATE_SWIFT).not.toContain("import react_native_carplay");
      expect(CAR_SCENE_DELEGATE_SWIFT).toContain("RNCarPlay.connect(with:");
    });
  });
});
