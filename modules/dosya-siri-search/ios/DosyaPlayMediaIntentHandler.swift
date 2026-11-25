import Intents

public class DosyaPlayMediaIntentHandler: NSObject, INPlayMediaIntentHandling {
  public func resolveMediaItems(
    for intent: INPlayMediaIntent,
    with completion: @escaping ([INPlayMediaMediaItemResolutionResult]) -> Void
  ) {
    // Freeform search happens in JS (src/incar/search.ts), not via per-item
    // media resolution here.
    completion([])
  }

  public func confirm(intent: INPlayMediaIntent, completion: @escaping (INPlayMediaIntentResponse) -> Void) {
    completion(INPlayMediaIntentResponse(code: .success, userActivity: nil))
  }

  public func handle(intent: INPlayMediaIntent, completion: @escaping (INPlayMediaIntentResponse) -> Void) {
    let query = intent.mediaSearch?.mediaName
      ?? intent.mediaSearch?.artistName
      ?? intent.mediaSearch?.albumName
      ?? ""
    SiriSearchBridge.shared.deliver(query)
    completion(INPlayMediaIntentResponse(code: .success, userActivity: nil))
  }
}
