import Foundation

/// A task that JS cancelled, identified by the pair rather than the job id
/// alone: the same id can be enqueued again straight away, and the new task
/// must not be swallowed by the old cancellation.
private struct CancelledTask: Hashable {
  let jobId: String
  let taskId: Int
}

/// The one background URLSession. Created on first touch, and touched from
/// the app-delegate subscriber BEFORE any JS runs, because iOS delivers
/// relaunch events to whichever object claims the identifier.
final class BackgroundUploadSession: NSObject, URLSessionDataDelegate {
  static let shared = BackgroundUploadSession()
  static let identifier = "dev.dosya.app.backup-upload"

  private(set) lazy var session: URLSession = {
    let config = URLSessionConfiguration.background(withIdentifier: BackgroundUploadSession.identifier)
    config.isDiscretionary = false
    config.sessionSendsLaunchEvents = true
    config.timeoutIntervalForResource = 48 * 60 * 60
    config.httpMaximumConnectionsPerHost = 4
    // A ceiling, not the Wi-Fi-only setting. A session's configuration is
    // frozen when the session is created, and the session is created once at
    // module start (OnCreate touches it) or on relaunch, in both cases before
    // any enqueue call, so a session-level flag could never follow the toggle.
    // The toggle is applied per request in `enqueue` instead: URLRequest has
    // its own `allowsCellularAccess`, captured when the task is created and
    // carried with the task across a relaunch. The alternative, rebuilding the
    // session whenever the setting changes, is the more fragile of the two: a
    // background session identifier cannot be reused until the previous
    // session has finished invalidating.
    config.allowsCellularAccess = true
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()

  /// The Wi-Fi-only setting as JS last passed it to `enqueue`; stamped onto
  /// every request created from that call onwards. Tasks already in flight keep
  /// the value they were created with.
  var allowsCellular = false
  var relaunchCompletion: (() -> Void)?
  /// Set by the app-delegate subscriber, which is the only file that may see
  /// ExpoModulesCore. Run after our own relaunch handler, to release handlers
  /// other subscribers are holding for this session identifier.
  var releaseForeignRelaunchHandlers: (() -> Void)?
  var onJobFinished: (([String: Any]) -> Void)?
  var onProgress: (([String: Any]) -> Void)?
  private var lastProgressEmit = Date.distantPast
  private let store = BackgroundUploadStore.shared
  /// Tasks JS asked to cancel. `didCompleteWithError` still fires for a
  /// cancelled task; the pair sits here so that arrival is swallowed rather
  /// than reported as a failure for a job JS has already dropped.
  private var cancelled = Set<CancelledTask>()
  /// The start of each task's response body, by task identifier.
  ///
  /// A failed PUT used to reach JS as "HTTP 403" and nothing else, so every
  /// storage-side refusal - an expired signature, a clock skew, a policy
  /// mismatch - looked identical on the failed-items screen and in a bug
  /// report. R2 says exactly which it is in the body; the first few hundred
  /// bytes of it carry the code and the message.
  private var responseBodies: [Int: Data] = [:]
  /// Enough for the code and message of an S3-style error document. The point
  /// is to name the failure, not to keep the document.
  private static let responseBodyLimit = 512
  private let lock = NSLock()

  // MARK: Job lifecycle

  /// Takes the raw entries JS sent so that a malformed one can be recorded
  /// against its job id instead of vanishing: JS is waiting for a result for
  /// every job it staged a file for, and a dropped entry would strand that
  /// staged file in the budget forever.
  func enqueue(_ entries: [[String: Any]]) {
    for entry in entries {
      guard let jobId = entry["jobId"] as? String, !jobId.isEmpty else {
        // No id to report against, so a log line is all there is.
        NSLog("[dosya-background-upload] dropped an enqueue entry with no jobId")
        continue
      }
      let path = (entry["path"] as? String) ?? ""
      guard !path.isEmpty else { recordInvalid(jobId: jobId, path: path, reason: "missing path"); continue }
      guard let urlString = entry["url"] as? String, let url = URL(string: urlString), url.scheme != nil else {
        recordInvalid(jobId: jobId, path: path, reason: "unusable url")
        continue
      }
      // Absent headers are a bug in the caller, not an empty header set: a PUT
      // with no authorization would fail at the edge anyway, and failing here
      // says why.
      guard let headers = entry["headers"] as? [String: String] else {
        recordInvalid(jobId: jobId, path: path, reason: "missing headers")
        continue
      }

      var request = URLRequest(url: url)
      request.httpMethod = "PUT"
      request.allowsCellularAccess = allowsCellular
      for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
      let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? NSNumber)?.int64Value ?? 0
      let task = session.uploadTask(with: request, fromFile: URL(fileURLWithPath: path))
      task.taskDescription = jobId
      // Persisted BEFORE resume, or a callback could arrive for a job the
      // file does not know.
      store.withJobs { $0[jobId] = PersistedJob(jobId: jobId, taskId: task.taskIdentifier, path: path, state: "queued", bytesSent: 0, bytesTotal: max(0, size), httpStatus: nil, etag: nil, error: nil, acknowledged: false) }
      task.resume()
    }
  }

  /// A job that never became a task. Written as a terminal row so `drain`
  /// hands it to JS exactly like a real failure, then announced.
  private func recordInvalid(jobId: String, path: String, reason: String) {
    let message = "invalid job: \(reason)"
    store.withJobs { $0[jobId] = PersistedJob(jobId: jobId, taskId: -1, path: path, state: "failed", bytesSent: 0, bytesTotal: 0, httpStatus: nil, etag: nil, error: message, acknowledged: false) }
    onJobFinished?(["jobId": jobId, "ok": false, "error": message])
  }

  func pending() -> [[String: Any]] {
    store.readJobs().values.filter { !$0.acknowledged }.map { j in
      var d: [String: Any] = ["jobId": j.jobId, "state": j.state, "bytesSent": j.bytesSent, "bytesTotal": j.bytesTotal]
      if let s = j.httpStatus { d["httpStatus"] = s }
      if let e = j.etag { d["etag"] = e }
      if let e = j.error { d["error"] = e }
      return d
    }
  }

  /// Every done/failed job not yet handed to JS; drops them from the file in
  /// the same critical section that reads them, so two drains can never return
  /// the same result twice. Idempotent by construction.
  func drain() -> [[String: Any]] {
    store.withJobs { jobs in
      var out: [[String: Any]] = []
      for (id, j) in jobs where !j.acknowledged && (j.state == "done" || j.state == "failed") {
        var d: [String: Any] = ["jobId": j.jobId, "ok": j.state == "done"]
        if let s = j.httpStatus { d["httpStatus"] = s }
        if let e = j.etag { d["etag"] = e }
        if let e = j.error { d["error"] = e }
        out.append(d)
        jobs.removeValue(forKey: id)
      }
      return out
    }
  }

  /// Takes the identity of each doomed job and drops its row in one critical
  /// section, so an enqueue of the same id immediately afterwards gets a fresh
  /// row and a fresh task identifier that this cancellation cannot touch. Only
  /// the tasks those captured identities name are cancelled, and only the
  /// captured pairs are suppressed in `didCompleteWithError`.
  func cancel(jobIds: [String]) {
    let ids = Set(jobIds)
    guard !ids.isEmpty else { return }
    let doomed: [CancelledTask] = store.withJobs { jobs in
      var out: [CancelledTask] = []
      for id in ids {
        guard let j = jobs.removeValue(forKey: id) else { continue }
        out.append(CancelledTask(jobId: id, taskId: j.taskId))
      }
      return out
    }
    guard !doomed.isEmpty else { return }
    lock.lock(); cancelled.formUnion(doomed); lock.unlock()
    session.getAllTasks { tasks in
      var matched = Set<CancelledTask>()
      for t in tasks {
        // Task identifiers restart at 1 with every new session object, so a row
        // persisted by an earlier launch can carry the identifier of an
        // unrelated live task. The description is the tie-breaker; where the
        // task has none and more than one doomed row claims the identifier,
        // cancelling either one could hit the wrong upload, so cancel neither.
        let candidates = doomed.filter { $0.taskId == t.taskIdentifier }
        guard !candidates.isEmpty else { continue }
        let pair: CancelledTask?
        if let description = t.taskDescription, !description.isEmpty {
          pair = candidates.first { $0.jobId == description }
        } else {
          pair = candidates.count == 1 ? candidates[0] : nil
        }
        guard let target = pair else { continue }
        matched.insert(target)
        t.cancel()
      }
      // Pairs with no live task get no completion callback to clear them.
      let unmatched = doomed.filter { !matched.contains($0) }
      if !unmatched.isEmpty {
        self.lock.lock(); self.cancelled.subtract(unmatched); self.lock.unlock()
      }
    }
  }

  /// A reboot, a force quit or a crash kills tasks without ever delivering a
  /// completion, leaving rows stuck at queued/running: `drain` would never
  /// return them, JS would never delete their staged copies, and the staging
  /// budget would fill with files nothing is uploading. Fails every stored job
  /// whose task the session no longer has.
  ///
  /// The candidate set is snapshotted before the (asynchronous) task listing,
  /// and each row is re-checked against that snapshot's taskId, so a job
  /// enqueued while the listing is in flight is never mistaken for a dead one.
  func reconcile() {
    let snapshot = store.readJobs()
    let candidates = snapshot.values.filter { $0.state == "queued" || $0.state == "running" }
    guard !candidates.isEmpty else { return }
    session.getAllTasks { tasks in
      let live = Set(tasks.map { $0.taskIdentifier })
      var finished: [[String: Any]] = []
      self.store.withJobs { jobs in
        for candidate in candidates where !live.contains(candidate.taskId) {
          guard var j = jobs[candidate.jobId], j.taskId == candidate.taskId else { continue }
          guard j.state == "queued" || j.state == "running" else { continue }
          j.state = "failed"
          j.error = "task missing after relaunch"
          jobs[candidate.jobId] = j
          finished.append(["jobId": j.jobId, "ok": false, "error": j.error ?? ""])
        }
      }
      for payload in finished { self.onJobFinished?(payload) }
    }
  }

  // MARK: URLSessionTaskDelegate

  /// `taskDescription` is set when the task is created, but a relaunch into a
  /// fresh process is not obliged to bring it back, so fall back to the
  /// persisted taskId and re-stamp the description for the callbacks that
  /// follow.
  ///
  /// Identifiers restart at 1 with every new session object, so a terminal row
  /// left by an earlier launch and not yet drained can share one with a live
  /// task. An unfinished row is therefore preferred over a terminal one, and
  /// an ambiguous match returns nil rather than attributing a completion to the
  /// wrong job: dictionary order is no basis for that decision.
  private func jobId(for task: URLSessionTask) -> String? {
    if let id = task.taskDescription, !id.isEmpty { return id }
    let rows = store.readJobs().values.filter { $0.taskId == task.taskIdentifier }
    let unfinished = rows.filter { $0.state == "queued" || $0.state == "running" }
    let match: PersistedJob?
    if unfinished.count == 1 {
      match = unfinished[0]
    } else if unfinished.isEmpty && rows.count == 1 {
      match = rows[0]
    } else {
      match = nil
    }
    guard let job = match else {
      if !rows.isEmpty {
        NSLog("[dosya-background-upload] task identifier \(task.taskIdentifier) matches \(rows.count) jobs (\(unfinished.count) unfinished); not attributing")
      }
      return nil
    }
    task.taskDescription = job.jobId
    return job.jobId
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    guard let id = jobId(for: task) else { return }
    let now = Date()
    let due = now.timeIntervalSince(lastProgressEmit) >= 0.5
    // In memory on every callback; to disk only on the first transition to
    // running and when the throttle fires, because a flush is a full re-encode
    // of every job plus an atomic file rewrite.
    let transitioned: Bool = store.withJobs(flush: false) { jobs in
      guard var j = jobs[id] else { return false }
      let changed = j.state != "running"
      j.state = "running"
      j.bytesSent = max(0, totalBytesSent)
      // NSURLSessionTransferSizeUnknown is -1; the size captured at enqueue is
      // the better answer then.
      if totalBytesExpectedToSend > 0 { j.bytesTotal = totalBytesExpectedToSend }
      jobs[id] = j
      return changed
    }
    if transitioned || due { store.flush() }
    guard due else { return }
    lastProgressEmit = now
    let all = store.readJobs().values
    onProgress?(["bytesSent": all.reduce(Int64(0)) { $0 + $1.bytesSent }, "bytesTotal": all.reduce(Int64(0)) { $0 + $1.bytesTotal }])
  }

  /// Upload tasks deliver their response body here. Bounded and dropped at
  /// completion, so a chatty error document cannot grow in memory.
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.lock()
    defer { lock.unlock() }
    let sofar = responseBodies[dataTask.taskIdentifier] ?? Data()
    let room = BackgroundUploadSession.responseBodyLimit - sofar.count
    guard room > 0 else { return }
    responseBodies[dataTask.taskIdentifier] = sofar + data.prefix(room)
  }

  /// One line of a response body, or nil when there is nothing worth saying.
  private func bodyPrefix(_ data: Data?) -> String? {
    guard let data, let text = String(data: data, encoding: .utf8) else { return nil }
    let oneLine = text
      .replacingOccurrences(of: "\n", with: " ")
      .replacingOccurrences(of: "\r", with: " ")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return oneLine.isEmpty ? nil : oneLine
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    // Taken before the guard: a task whose job cannot be named still has to
    // give its buffer back.
    lock.lock()
    let body = responseBodies.removeValue(forKey: task.taskIdentifier)
    lock.unlock()
    guard let id = jobId(for: task) else { return }
    lock.lock()
    let wasCancelled = cancelled.remove(CancelledTask(jobId: id, taskId: task.taskIdentifier)) != nil
    lock.unlock()
    if wasCancelled {
      // JS dropped this job and `cancel` already removed its row. Remove it
      // again only if the row still belongs to this task: the same id may have
      // been enqueued again since, and that row is live.
      store.withJobs { jobs in
        if jobs[id]?.taskId == task.taskIdentifier { jobs.removeValue(forKey: id) }
      }
      return
    }
    let http = task.response as? HTTPURLResponse
    let status = http?.statusCode
    let etag = http?.value(forHTTPHeaderField: "ETag")?.replacingOccurrences(of: "\"", with: "")
    let ok = error == nil && (status ?? 0) >= 200 && (status ?? 0) < 300
    // Storage says why in the body; without it every refusal reads as a bare
    // "HTTP 403" on the failed-items screen and in every bug report.
    let refusal = bodyPrefix(body).map { "HTTP \(status ?? 0): \($0)" } ?? "HTTP \(status ?? 0)"
    let message = error?.localizedDescription ?? (ok ? nil : refusal)
    // Written to disk BEFORE the event: JS may not be running.
    store.withJobs { jobs in
      jobs[id]?.state = ok ? "done" : "failed"; jobs[id]?.httpStatus = status; jobs[id]?.etag = etag; jobs[id]?.error = message
    }
    var payload: [String: Any] = ["jobId": id, "ok": ok]
    if let s = status { payload["httpStatus"] = s }
    if let e = etag { payload["etag"] = e }
    if let m = message { payload["error"] = m }
    onJobFinished?(payload)
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    DispatchQueue.main.async {
      let completion = self.relaunchCompletion
      self.relaunchCompletion = nil
      completion?()
      self.releaseForeignRelaunchHandlers?()
    }
  }
}
