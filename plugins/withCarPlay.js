const {
  withEntitlementsPlist,
  withInfoPlist,
  withDangerousMod,
  withXcodeProject,
  withAppDelegate,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");
const { CAR_SCENE_DELEGATE_SWIFT, PHONE_SCENE_DELEGATE_SWIFT } = require("./carPlaySceneDelegates");

function withCarPlayEntitlement(config) {
  return withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.developer.carplay-audio"] = true;
    return config;
  });
}

function withCarPlaySceneManifest(config) {
  return withInfoPlist(config, (config) => {
    const existing = config.modResults.UIApplicationSceneManifest ?? {};
    config.modResults.UIApplicationSceneManifest = {
      ...existing,
      UIApplicationSupportsMultipleScenes: true,
      UISceneConfigurations: {
        ...existing.UISceneConfigurations,
        CPTemplateApplicationSceneSessionRoleApplication: [
          {
            UISceneClassName: "CPTemplateApplicationScene",
            UISceneConfigurationName: "CarPlay",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).CarSceneDelegate",
          },
        ],
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneClassName: "UIWindowScene",
            UISceneConfigurationName: "Phone",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).PhoneSceneDelegate",
          },
        ],
      },
    };
    return config;
  });
}

const BRIDGING_HEADER_IMPORT = "#import <react-native-carplay/RNCarPlay.h>";

/**
 * Exposes the Obj-C-only `RNCarPlay` class to CarSceneDelegate.swift.
 *
 * react-native-carplay's podspec declares `s.source_files = "ios/*.{h,m}"` with
 * no `defines_module`/`s.static_framework`, and this project does not enable
 * `use_frameworks!` (ios/Podfile.properties.json), so CocoaPods produces no
 * Swift module for it - `import react_native_carplay` in Swift fails with "no
 * such module" and breaks EVERY iOS build. The bridging header is the supported
 * route for Obj-C-only pods: CocoaPods copies the pod's public headers to
 * `${PODS_ROOT}/Headers/Public/react-native-carplay/`, and that directory's
 * parent is already on the app target's HEADER_SEARCH_PATHS (verified in the
 * generated Pods-<project>.debug.xcconfig), so the angle-bracket import resolves.
 *
 * The Expo template already generates `ios/<projectName>/<projectName>-Bridging-Header.h`
 * and the app target's SWIFT_OBJC_BRIDGING_HEADER already points at it (verified
 * in the generated project.pbxproj, both Debug and Release configurations), so
 * this only has to append - never create the setting, and never overwrite the
 * file, which other plugins may also be appending to.
 */
function withCarPlayBridgingHeader(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const { platformProjectRoot, projectName } = config.modRequest;
      const headerPath = path.join(platformProjectRoot, projectName, `${projectName}-Bridging-Header.h`);
      const existing = fs.existsSync(headerPath) ? fs.readFileSync(headerPath, "utf8") : "";
      if (existing.includes(BRIDGING_HEADER_IMPORT)) return config;
      const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
      fs.writeFileSync(headerPath, `${existing}${separator}${BRIDGING_HEADER_IMPORT}\n`);
      return config;
    },
  ]);
}

/** Writes the two scene delegate .swift files into the main target's directory. */
function withCarPlaySceneFiles(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const iosRoot = path.join(config.modRequest.platformProjectRoot, config.modRequest.projectName);
      fs.writeFileSync(path.join(iosRoot, "CarSceneDelegate.swift"), CAR_SCENE_DELEGATE_SWIFT);
      fs.writeFileSync(path.join(iosRoot, "PhoneSceneDelegate.swift"), PHONE_SCENE_DELEGATE_SWIFT);
      return config;
    },
  ]);
}

/**
 * Registers the two new .swift files with the Xcode project so they're
 * actually compiled — writing them to disk (previous mod) isn't enough.
 *
 * VERIFIED against a real `npx expo prebuild --platform ios --clean` output
 * (Expo SDK 54 / xcode@3.x, generated project name "dosyadev"):
 * `project.getFirstTarget()` is correct, and `config.modRequest.projectName`
 * ("dosyadev") does match the main app group's `name`. However
 * `project.pbxGroupByName(groupName)` — the API this comment originally
 * suggested — returns the PBXGroup *object*, not its key, and passing that
 * object straight into `addSourceFile`'s `group` argument (which expects a
 * key/uuid string) throws `TypeError: Cannot convert object to primitive
 * value` inside `xcode`'s `getPBXGroupByKey`/`addFile`. `findPBXGroupKey`
 * returns the key `pbxProject.addFile`/`addSourceFile` actually expect, and
 * with it the two files land as real children of the main "dosyadev" group
 * (not "Recovered References") and are added to the target's Sources build
 * phase — confirmed by grepping the generated `project.pbxproj` after prebuild.
 *
 * The paths MUST include the `<projectName>/` prefix. The main app group is
 * `{ name = dosyadev; sourceTree = "<group>"; }` with NO `path` of its own, so a
 * child added as the bare `"CarSceneDelegate.swift"` gets
 * `path = CarSceneDelegate.swift` and Xcode resolves it against SOURCE_ROOT
 * (`ios/`), not `ios/dosyadev/` where withCarPlaySceneFiles actually writes it -
 * producing `error: Build input files cannot be found: '.../ios/CarSceneDelegate.swift'`
 * and failing the whole app target's Swift compile. Every sibling in that group
 * is declared the same way (`name = AppDelegate.swift; path = dosyadev/AppDelegate.swift`),
 * which is what this now matches. Grepping the pbxproj for the file names is NOT
 * enough to catch this - only a real app-target build is.
 */
function withCarPlaySceneXcodeRefs(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const target = project.getFirstTarget().uuid;
    const groupName = config.modRequest.projectName;
    const group = project.findPBXGroupKey({ name: groupName });
    for (const name of ["CarSceneDelegate.swift", "PhoneSceneDelegate.swift"]) {
      project.addSourceFile(`${groupName}/${name}`, { target }, group);
    }
    return config;
  });
}

/**
 * Routes CarPlay connections to CarSceneDelegate, everything else to PhoneSceneDelegate.
 *
 * NOT `override`: `ExpoAppDelegate` (node_modules/expo/ios/AppDelegates/ExpoAppDelegate.swift)
 * does not implement `application(_:configurationForConnecting:options:)` at all
 * - it's an optional `UIApplicationDelegate` protocol requirement, and marking
 * the implementation `override` fails the whole app target's Swift compile with
 * "method does not override any method from its superclass". Same reasoning as
 * withSiriPlayIntent.js's `handlerFor`.
 *
 * `import CarPlay` is added explicitly for `UISceneSession.Role.carTemplateApplication`,
 * which is declared by the CarPlay framework. Swift imports are file-scoped, so
 * CarSceneDelegate.swift's own `import CarPlay` does nothing for this file.
 * (The bridging header's `#import <react-native-carplay/RNCarPlay.h>` happens to
 * pull CarPlay in module-wide as well, but relying on that would make this method
 * silently dependent on an unrelated plugin step.)
 */
function withCarPlayAppDelegateRouting(config) {
  return withAppDelegate(config, (config) => {
    const anchor = "public class AppDelegate: ExpoAppDelegate {";
    if (!config.modResults.contents.includes("import CarPlay")) {
      config.modResults.contents = config.modResults.contents.replace(
        "import Expo",
        "import Expo\nimport CarPlay",
      );
    }
    if (!config.modResults.contents.includes("configurationForConnecting")) {
      config.modResults.contents = config.modResults.contents.replace(
        anchor,
        `${anchor}
  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    if connectingSceneSession.role == UISceneSession.Role.carTemplateApplication {
      let scene = UISceneConfiguration(name: "CarPlay", sessionRole: connectingSceneSession.role)
      scene.delegateClass = CarSceneDelegate.self
      return scene
    }
    let scene = UISceneConfiguration(name: "Phone", sessionRole: connectingSceneSession.role)
    scene.delegateClass = PhoneSceneDelegate.self
    return scene
  }
`,
      );
    }
    return config;
  });
}

function withCarPlay(config) {
  config = withCarPlayEntitlement(config);
  config = withCarPlaySceneManifest(config);
  config = withCarPlayBridgingHeader(config);
  config = withCarPlaySceneFiles(config);
  config = withCarPlaySceneXcodeRefs(config);
  config = withCarPlayAppDelegateRouting(config);
  return config;
}

// Expo's config-plugin resolver (`resolveConfigPluginExport` in
// @expo/config-plugins/build/utils/plugin-resolver.js) requires that
// `require("./plugins/withCarPlay")` itself be a function (or have a
// `.default` that is one) when app.config.ts references the plugin by bare
// file path - a plain `module.exports = { withCarPlay }` throws
// `PluginError: Plugin "./plugins/withCarPlay" must export a function` during
// `expo prebuild`. Exporting the function itself while also attaching it as a
// named property keeps `require("./withCarPlay").withCarPlay` working for the
// Jest test above.
module.exports = withCarPlay;
module.exports.withCarPlay = withCarPlay;
module.exports.default = withCarPlay;
