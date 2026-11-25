const { withEntitlementsPlist, withInfoPlist, withAppDelegate } = require("expo/config-plugins");

function withSiriPlayIntent(config) {
  config = withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.developer.siri"] = true;
    return config;
  });

  config = withInfoPlist(config, (config) => {
    const existing = config.modResults.NSUserActivityTypes ?? [];
    if (!existing.includes("INPlayMediaIntent")) {
      config.modResults.NSUserActivityTypes = [...existing, "INPlayMediaIntent"];
    }
    // Siri won't offer the app for a media intent without a usage description.
    config.modResults.NSSiriUsageDescription =
      config.modResults.NSSiriUsageDescription ?? "Used to play your files by voice, including in CarPlay.";
    return config;
  });

  config = withAppDelegate(config, (config) => {
    const anchor = "public class AppDelegate: ExpoAppDelegate {";
    if (!config.modResults.contents.includes("handlerFor intent:")) {
      config.modResults.contents = config.modResults.contents.replace(
        anchor,
        // NOT `override`: ExpoAppDelegate has no `application(_:handlerFor:)` of
        // its own (its source literally carries a "TODO: - Handling SiriKit
        // Intents" where it would go), so this is an optional
        // UIApplicationDelegate protocol requirement being implemented for the
        // first time. Marking it `override` fails the whole app target's Swift
        // compile with "method does not override any method from its superclass".
        `${anchor}
  public func application(_ application: UIApplication, handlerFor intent: INIntent) -> Any? {
    if intent is INPlayMediaIntent {
      return DosyaPlayMediaIntentHandler()
    }
    return nil
  }
`,
      );
    }
    // Two separate imports, each behind its own existence guard so re-running
    // prebuild against an already-patched AppDelegate.swift can't double-insert
    // either one:
    //   - Intents           -> INIntent / INPlayMediaIntent, the method signature
    //   - DosyaSiriSearch   -> DosyaPlayMediaIntentHandler, which lives in the
    //     local Expo module's own pod (modules/dosya-siri-search/ios/DosyaSiriSearch.podspec).
    //     That pod DOES produce a real Swift module (it ships .swift sources and
    //     sets s.static_framework = true), unlike the Obj-C-only
    //     react-native-carplay pod which has to go through the bridging header
    //     instead - see withCarPlay.js.
    if (!config.modResults.contents.includes("import Intents")) {
      config.modResults.contents = config.modResults.contents.replace(
        "import Expo",
        "import Expo\nimport Intents",
      );
    }
    if (!config.modResults.contents.includes("import DosyaSiriSearch")) {
      config.modResults.contents = config.modResults.contents.replace(
        "import Expo",
        "import Expo\nimport DosyaSiriSearch",
      );
    }
    return config;
  });

  return config;
}

// Expo's config-plugin resolver (`resolveConfigPluginExport` in
// @expo/config-plugins/build/utils/plugin-resolver.js) requires that
// `require("./plugins/withSiriPlayIntent")` itself be a function (or have a
// `.default` that is one) when app.config.ts references the plugin by bare
// file path - a plain `module.exports = { withSiriPlayIntent }` throws
// `PluginError: Plugin "./plugins/withSiriPlayIntent" must export a function`
// during `expo prebuild` (same bug hit and fixed in withCarPlay.js - see that
// file's comment). Exporting the function itself while also attaching it as a
// named property keeps `require("./withSiriPlayIntent").withSiriPlayIntent`
// working for tooling that expects the named export.
module.exports = withSiriPlayIntent;
module.exports.withSiriPlayIntent = withSiriPlayIntent;
module.exports.default = withSiriPlayIntent;
