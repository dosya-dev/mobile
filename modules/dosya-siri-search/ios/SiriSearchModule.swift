import ExpoModulesCore

public class SiriSearchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SiriSearch")
    Events("query")

    OnStartObserving {
      SiriSearchBridge.shared.onQuery = { [weak self] text in
        self?.sendEvent("query", ["text": text])
      }
    }
    OnStopObserving {
      SiriSearchBridge.shared.onQuery = nil
    }
    Function("takePendingQuery") { () -> String? in
      SiriSearchBridge.shared.take()
    }
  }
}
