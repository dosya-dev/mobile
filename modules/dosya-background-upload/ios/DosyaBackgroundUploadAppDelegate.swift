import ExpoModulesCore

/// iOS relaunches the app in the background to deliver URLSession events.
/// Claiming the session here, before JS boots, is what makes the delegate
/// callbacks reach BackgroundUploadSession instead of being dropped.
public class DosyaBackgroundUploadAppDelegate: ExpoAppDelegateSubscriber {
  /// Subscribers known to park a relaunch completion handler under the session
  /// identifier and hand it back only when asked. See `releaseForeignHandlers`.
  private static let foreignHandlerHolders = ["FileSystemBackgroundSessionHandler"]
  private static let releaseSelectorName = "invokeCompletionHandlerForSessionIdentifier:"

  public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
    // Installed here rather than at init because this call is the only moment
    // a foreign subscriber can have taken a handler for our identifier.
    // Named rather than `Self.`, which would capture this instance in the
    // closure the session holds for the life of the process.
    BackgroundUploadSession.shared.releaseForeignRelaunchHandlers = {
      DosyaBackgroundUploadAppDelegate.releaseForeignHandlers(for: BackgroundUploadSession.identifier)
    }
    guard identifier == BackgroundUploadSession.identifier else {
      // Someone else's session. Expo hands this call to every subscriber that
      // implements it and only calls the system handler once each of them has
      // called the handler it was given, so returning in silence would strand
      // the relaunch. Hand it straight back instead.
      completionHandler()
      return
    }
    // A handler held from an earlier relaunch whose events never arrived would
    // be lost by the assignment below, so hand it back rather than drop it.
    let previous = BackgroundUploadSession.shared.relaunchCompletion
    BackgroundUploadSession.shared.relaunchCompletion = completionHandler
    _ = BackgroundUploadSession.shared.session
    previous?()
  }

  /// The other half of the aggregation described above: expo-file-system's
  /// FileSystemBackgroundSessionHandler implements the delegate method for
  /// EVERY identifier, files the handler Expo gave it under that identifier,
  /// and releases it only when its own module finishes a task on that session,
  /// which will never happen for ours. Its count would never reach zero and
  /// the system handler would never fire, so ask it directly through the
  /// selector EXSessionHandlerProtocol declares. Every step is optional: an
  /// Expo version without the repository, without that subscriber, or with a
  /// renamed selector is a silent no-op.
  private static func releaseForeignHandlers(for identifier: String) {
    let selector = NSSelectorFromString(releaseSelectorName)
    for name in foreignHandlerHolders {
      // `getSubscriber` compares against `String(describing:)` of the instance,
      // which for an NSObject is "<Name: 0x...>", so match the type name too.
      let byName = ExpoAppDelegateSubscriberRepository.getSubscriber(name)
      let byType = ExpoAppDelegateSubscriberRepository.subscribers.first(where: { String(describing: type(of: $0)) == name })
      guard let found = byName ?? byType else { continue }
      guard let target = found as? NSObject, target.responds(to: selector) else { continue }
      _ = target.perform(selector, with: identifier)
    }
  }
}
