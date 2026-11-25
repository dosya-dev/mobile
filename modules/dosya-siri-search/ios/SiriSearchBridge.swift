import Foundation

/**
 * In-process handoff from the Siri intent handler (a UIApplicationDelegate
 * callback, not a separate extension — see the spec's Voice flow section for
 * why) to the Expo module. Two delivery paths: `onQuery` fires immediately if
 * the JS bridge is already listening (app was already running); `take()`
 * covers a cold launch, where Siri starts the process and JS isn't listening
 * yet by the time the intent handler runs.
 */
public class SiriSearchBridge {
  public static let shared = SiriSearchBridge()
  private init() {}

  public var onQuery: ((String) -> Void)?
  private var pending: String?

  public func deliver(_ query: String) {
    if let onQuery = onQuery {
      onQuery(query)
    } else {
      pending = query
    }
  }

  public func take() -> String? {
    defer { pending = nil }
    return pending
  }
}
