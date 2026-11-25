import ExpoModulesCore

/// iOS requires every BGProcessingTask launch handler to be registered before
/// the app finishes launching, and a background launch for the Personas task
/// arrives before JS exists. Registering here (like expo-background-task's
/// own subscriber, which owns `com.expo.modules.backgroundtask.processing`;
/// the identifiers differ, so the two never collide) lets the task wait in
/// PersonasWindows until the JS runner subscribes.
public class PersonasBackgroundAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    PersonasWindows.shared.registerProcessingHandler()
    return true
  }
}
