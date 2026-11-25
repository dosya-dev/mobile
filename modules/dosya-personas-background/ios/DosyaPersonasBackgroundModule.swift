import ExpoModulesCore
import UIKit

/// JS side of the Personas background windows (see PersonasWindows and
/// modules/dosya-personas-background/index.ts).
public class DosyaPersonasBackgroundModule: Module {
  private var memoryObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("DosyaPersonasBackground")

    Events(PersonasWindows.windowEvent, PersonasWindows.expiredEvent, "onMemoryWarning")

    OnCreate {
      PersonasWindows.shared.attach { [weak self] name, body in
        self?.sendEvent(name, body)
      }
    }

    OnDestroy {
      PersonasWindows.shared.detach()
      self.stopMemoryWarnings()
    }

    // Per event, so a memory-warning listener does not flush window events
    // before the runner listens for them.
    OnStartObserving(PersonasWindows.windowEvent) {
      PersonasWindows.shared.startListening(PersonasWindows.windowEvent)
    }
    OnStopObserving(PersonasWindows.windowEvent) {
      PersonasWindows.shared.stopListening(PersonasWindows.windowEvent)
    }
    OnStartObserving(PersonasWindows.expiredEvent) {
      PersonasWindows.shared.startListening(PersonasWindows.expiredEvent)
    }
    OnStopObserving(PersonasWindows.expiredEvent) {
      PersonasWindows.shared.stopListening(PersonasWindows.expiredEvent)
    }
    OnStartObserving("onMemoryWarning") {
      self.startMemoryWarnings()
    }
    OnStopObserving("onMemoryWarning") {
      self.stopMemoryWarnings()
    }

    Function("windowDone") { (id: String, _ moreLeft: Bool) in
      // moreLeft is the runner's business on iOS: it calls scheduleWindow.
      PersonasWindows.shared.complete(id, success: true)
    }

    AsyncFunction("scheduleWindow") { (requiresPower: Bool) in
      try PersonasWindows.shared.scheduleProcessing(requiresPower: requiresPower)
    }

    AsyncFunction("cancelWindows") {
      PersonasWindows.shared.cancelPending()
    }

    Function("supportsContinued") { () -> Bool in
      PersonasWindows.shared.supportsContinued
    }

    AsyncFunction("startContinued") { (title: String, subtitle: String) -> Bool in
      PersonasWindows.shared.startContinued(title: title, subtitle: subtitle)
    }

    Function("setWindowProgress") { (id: String, read: Int, total: Int, text: String) in
      PersonasWindows.shared.setProgress(id, read: read, total: total, text: text)
    }

    AsyncFunction("backgroundBlocks") { () -> [String] in
      UIApplication.shared.backgroundRefreshStatus == .available ? [] : ["refreshOff"]
    }.runOnQueue(.main)

    // Every block opens the app's own page in Settings on iOS.
    AsyncFunction("openAppSettings") { (_ which: String) in
      if let url = URL(string: UIApplication.openSettingsURLString) {
        UIApplication.shared.open(url)
      }
    }.runOnQueue(.main)
  }

  private func startMemoryWarnings() {
    guard memoryObserver == nil else { return }
    memoryObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didReceiveMemoryWarningNotification,
      object: nil,
      queue: nil
    ) { [weak self] _ in
      self?.sendEvent("onMemoryWarning", [:])
    }
  }

  private func stopMemoryWarnings() {
    if let observer = memoryObserver {
      NotificationCenter.default.removeObserver(observer)
      memoryObserver = nil
    }
  }
}
