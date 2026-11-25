import ActivityKit
import ExpoModulesCore
import WidgetKit

let appGroup = "group.dev.dosya.app"
let snapshotKey = "backupStatus"

// Must stay identical to the definition in targets/backup-widget - ActivityKit
// matches attributes by type name + shape across the app/extension boundary.
struct BackupActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var done: Int
    var total: Int
    var bytesPerSec: Int
  }
  var workspaceName: String
}

public class DosyaBackupStatusModule: Module {
  private var activity: Any? // Activity<BackupActivityAttributes> (iOS 16.2+ only)

  public func definition() -> ModuleDefinition {
    Name("DosyaBackupStatus")

    // Widget data path: JSON snapshot into the shared App Group + timeline reload.
    // Throttling lives on the JS side (WidgetKit reload budget is limited).
    Function("setSnapshot") { (json: String) in
      UserDefaults(suiteName: appGroup)?.set(json, forKey: snapshotKey)
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }

    // Sign-out: the next account must not see this one's workspace or storage
    // on the home screen. iOS had the same gap as Android.
    Function("clearSnapshot") {
      UserDefaults(suiteName: appGroup)?.removeObject(forKey: snapshotKey)
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }

    Function("startActivity") { (workspaceName: String, total: Int) in
      guard #available(iOS 16.2, *) else { return }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
      let attributes = BackupActivityAttributes(workspaceName: workspaceName)
      let state = BackupActivityAttributes.ContentState(done: 0, total: total, bytesPerSec: 0)
      self.activity = try? Activity.request(
        attributes: attributes,
        content: .init(state: state, staleDate: nil)
      )
    }

    Function("updateActivity") { (done: Int, total: Int, bytesPerSec: Int) in
      guard #available(iOS 16.2, *) else { return }
      guard let activity = self.activity as? Activity<BackupActivityAttributes> else { return }
      let state = BackupActivityAttributes.ContentState(done: done, total: total, bytesPerSec: bytesPerSec)
      Task { await activity.update(.init(state: state, staleDate: nil)) }
    }

    // Launch hygiene: an app killed mid-run leaves its Live Activity stranded
    // on the lock screen / Dynamic Island (iOS keeps it up to 8h). Called on
    // bridge start so relaunches sweep any orphans immediately.
    Function("endAllActivities") {
      guard #available(iOS 16.2, *) else { return }
      Task {
        for activity in Activity<BackupActivityAttributes>.activities {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
      self.activity = nil
    }

    Function("endActivity") { (done: Int, total: Int) in
      guard #available(iOS 16.2, *) else { return }
      guard let activity = self.activity as? Activity<BackupActivityAttributes> else { return }
      self.activity = nil
      let state = BackupActivityAttributes.ContentState(done: done, total: total, bytesPerSec: 0)
      Task { await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .after(.now + 60)) }
    }
  }
}
