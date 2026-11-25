// NOTE (no `import react_native_carplay` here on purpose): react-native-carplay
// is an Objective-C-only pod (`s.source_files = "ios/*.{h,m}"`, no Swift, no
// `defines_module`) and this project does not use `use_frameworks!` (see
// ios/Podfile.properties.json), so CocoaPods generates no Swift module for it -
// `import react_native_carplay` fails with "no such module" and takes down every
// iOS build, not just CarPlay ones. `RNCarPlay` is instead exposed to Swift
// through the app target's bridging header (see withCarPlayBridgingHeader in
// withCarPlay.js), which needs no import statement at all.
const CAR_SCENE_DELEGATE_SWIFT = `import Foundation
import CarPlay

class CarSceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    RNCarPlay.connect(with: interfaceController, window: templateApplicationScene.carWindow)
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    RNCarPlay.disconnect()
  }
}
`;

// Adopting UIApplicationSceneManifest (required for CarPlay's
// CPTemplateApplicationScene) switches the WHOLE app onto UIKit's scene-based
// lifecycle. Once adopted UIKit stops calling `application(_:open:options:)` and
// `application(_:continue:restorationHandler:)` on the app delegate and calls the
// UISceneDelegate equivalents instead - so without the two forwarding methods
// below, `dosya://auth/callback` (OAuth) and universal links would stop reaching
// JS for every iOS user, CarPlay or not.
//
// Both forward straight back into the AppDelegate's own, unchanged
// implementations rather than re-deriving what they do, which preserves the full
// chain verified against the real generated AppDelegate.swift + package sources:
//   super.application(...)  -> ExpoAppDelegateSubscriberManager -> every
//                              ExpoAppDelegateSubscriber, incl. expo-linking's
//                              LinkingAppDelegateSubscriber, which stores the URL
//                              in ExpoLinkingRegistry.shared.initialURL - that is
//                              what expo-router reads via Linking.getLinkingURL()
//                              for the cold-start initial route
//   RCTLinkingManager.application(...) -> posts RCTOpenURLNotification -> RN's
//                              `url` event, i.e. Linking.addEventListener("url"),
//                              the warm/foreground deep-link path
const PHONE_SCENE_DELEGATE_SWIFT = `import UIKit

class PhoneSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = appDelegate.window?.rootViewController
    self.window = window
    window.makeKeyAndVisible()

    // Cold launch via a deep link / universal link. With scenes adopted, UIKit
    // hands the launching URL to the scene in \`connectionOptions\` and NOT in
    // \`didFinishLaunchingWithOptions\`'s launchOptions dictionary (which is where
    // RCTLinkingManager's getInitialURL reads from), so it has to be replayed
    // here or the launch URL is lost entirely.
    if !connectionOptions.urlContexts.isEmpty {
      self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    }
    for userActivity in connectionOptions.userActivities {
      self.scene(scene, continue: userActivity)
    }
  }

  // Replaces AppDelegate's application(_:open:options:), which UIKit no longer
  // calls once UIApplicationSceneManifest is adopted.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    let application = UIApplication.shared
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace,
      ]
      if let sourceApplication = context.options.sourceApplication {
        options[.sourceApplication] = sourceApplication
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }
      _ = appDelegate.application(application, open: context.url, options: options)
    }
  }

  // Replaces AppDelegate's application(_:continue:restorationHandler:), likewise
  // no longer called once scenes are adopted. Universal links and the Siri
  // INPlayMediaIntent NSUserActivity both arrive here.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

module.exports = { CAR_SCENE_DELEGATE_SWIFT, PHONE_SCENE_DELEGATE_SWIFT };
