import ExpoModulesCore

/// Staging runs on its own serial queue, off the shared Expo async-function
/// queue. A batch of exports is the longest call this module has - an iCloud
/// original can take tens of seconds to come down - and on the shared queue it
/// held up everything behind it: `drain` could not register finished uploads,
/// `pending`/`stagingUsage` could not answer the reconcile, and `cancel` could
/// not stop a run the user had just stopped. Serial, so two staging calls
/// still take it in turns and the budget check inside AssetStager stays sound.
/// `userInitiated` to match the queue it was taken off: a relaunch window is
/// seconds long, and staging demoted below it would not finish inside one.
private let stageQueue = DispatchQueue(label: "dev.dosya.background-upload.stage", qos: .userInitiated)

public class DosyaBackgroundUploadModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DosyaBackgroundUpload")
    Events("onJobFinished", "onProgress")

    OnCreate {
      BackgroundUploadSession.shared.onJobFinished = { [weak self] payload in self?.sendEvent("onJobFinished", payload) }
      BackgroundUploadSession.shared.onProgress = { [weak self] payload in self?.sendEvent("onProgress", payload) }
      _ = BackgroundUploadSession.shared.session
      // Rows left running by a reboot or a force quit have no task behind them
      // any more; fail them so drain surfaces them and their staged files stop
      // holding the budget.
      BackgroundUploadSession.shared.reconcile()
    }

    // The raw entries go through untouched: the session records a failed row
    // for a malformed one, which a compactMap here would silently swallow.
    AsyncFunction("enqueue") { (jobs: [[String: Any]], allowsCellular: Bool) in
      BackgroundUploadSession.shared.allowsCellular = allowsCellular
      BackgroundUploadSession.shared.enqueue(jobs)
    }

    AsyncFunction("pending") { () -> [[String: Any]] in BackgroundUploadSession.shared.pending() }
    AsyncFunction("drain") { () -> [[String: Any]] in BackgroundUploadSession.shared.drain() }
    AsyncFunction("cancel") { (jobIds: [String]) in BackgroundUploadSession.shared.cancel(jobIds: jobIds) }

    AsyncFunction("stagingUsage") { () -> [String: Any] in
      let u = BackgroundUploadStore.shared.usage()
      return ["bytes": u.bytes, "files": u.files]
    }

    AsyncFunction("removeStaged") { (paths: [String]) in
      BackgroundUploadStore.shared.remove(paths: paths)
    }

    // The caller names everything it still owns; whatever else is sitting in
    // the staging directory belongs to nobody and is holding the budget.
    AsyncFunction("sweepStaging") { (keepPaths: [String]) in
      BackgroundUploadStore.shared.sweepStaging(keepPaths: keepPaths)
    }

    AsyncFunction("stage") { (assets: [[String: String]], promise: Promise) in
      let reqs = assets.compactMap { a -> (localId: String, kind: String)? in
        guard let id = a["localId"] else { return nil }
        return (id, a["kind"] ?? "original")
      }
      AssetStager.stage(reqs, into: BackgroundUploadStore.shared) { staged, failed in
        let result: [String: Any] = [
          "staged": staged.map { s -> [String: Any] in
            ["localId": s.localId, "kind": s.kind, "path": s.path, "size": s.size, "filename": s.filename, "mime": s.mime]
          },
          "failed": failed.map { ["localId": $0.localId, "kind": $0.kind, "reason": $0.reason] },
        ]
        promise.resolve(result)
      }
    }.runOnQueue(stageQueue)
  }
}
