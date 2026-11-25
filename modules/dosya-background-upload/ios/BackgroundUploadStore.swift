import Foundation

/// One persisted job. Written before the URLSession task is resumed and
/// updated from the session delegate, so a relaunch can attribute callbacks
/// and JS can drain results that arrived while it was not running.
struct PersistedJob: Codable {
  var jobId: String
  var taskId: Int
  var path: String
  var state: String        // queued | running | done | failed
  var bytesSent: Int64
  var bytesTotal: Int64
  var httpStatus: Int?
  var etag: String?
  var error: String?
  var acknowledged: Bool
}

/// The staging directory and the job file, guarded by one serial queue.
/// Application Support rather than Caches: iOS purges Caches under pressure,
/// which would fail queued tasks mid-night.
final class BackgroundUploadStore {
  static let shared = BackgroundUploadStore()
  let queue = DispatchQueue(label: "dev.dosya.background-upload.store")
  let directory: URL
  private let jobsFile: URL
  private var jobs: [String: PersistedJob] = [:]

  private init() {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    directory = base.appendingPathComponent("backup-staging", isDirectory: true)
    jobsFile = directory.appendingPathComponent("jobs.json")
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    var dir = directory; try? dir.setResourceValues(values)
    if let data = try? Data(contentsOf: jobsFile), let decoded = try? JSONDecoder().decode([String: PersistedJob].self, from: data) {
      jobs = decoded
    }
  }

  /// `flush: false` keeps the change in memory only. Progress callbacks arrive
  /// hundreds of times a second and every flush is a full JSON re-encode plus
  /// an atomic rewrite, so byte counters are updated in memory and flushed on
  /// a state transition or when the progress throttle fires.
  func withJobs<T>(flush: Bool = true, _ body: (inout [String: PersistedJob]) -> T) -> T {
    queue.sync {
      let out = body(&jobs)
      if flush { write() }
      return out
    }
  }

  /// Writes what is in memory; pairs with `withJobs(flush: false)`.
  func flush() { queue.sync { write() } }

  /// Callers hold `queue`.
  private func write() {
    if let data = try? JSONEncoder().encode(jobs) { try? data.write(to: jobsFile, options: .atomic) }
  }

  func readJobs() -> [String: PersistedJob] { queue.sync { jobs } }

  /// Bytes and file count under the staging directory, the job file excluded.
  func usage() -> (bytes: Int64, files: Int) {
    var bytes: Int64 = 0; var files = 0
    if let items = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey]) {
      for url in items where url.lastPathComponent != "jobs.json" {
        files += 1
        bytes += Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
      }
    }
    return (bytes, files)
  }

  func remove(paths: [String]) {
    for p in paths { try? FileManager.default.removeItem(atPath: p) }
  }

  /// Deletes staged files nothing owns any more.
  ///
  /// A staged copy is normally removed the moment its result is acknowledged,
  /// but every path that skips that handshake leaves the file behind: a batch
  /// killed mid-plan, a ledger purged on sign-out, a workspace dropped from
  /// the destinations. Those files hold the staging budget until the app is
  /// deleted, and nothing else can name them - JS only knows the paths its own
  /// rows recorded.
  ///
  /// `keepPaths` is what the caller still owns (the staged copies of its
  /// queued rows). A file referenced by a persisted job is kept too, whatever
  /// the caller said: that one has a task uploading from it right now.
  ///
  /// `.part` files are exports in progress and are never named by either set,
  /// so they go only once they are too old to be anything but abandoned.
  func sweepStaging(keepPaths: [String]) {
    let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
    queue.sync {
      let keep = Set(keepPaths)
      let referenced = Set(jobs.values.map { $0.path })
      guard let items = try? FileManager.default.contentsOfDirectory(
        at: directory, includingPropertiesForKeys: [.contentModificationDateKey]
      ) else { return }
      for url in items where url.lastPathComponent != "jobs.json" {
        if url.pathExtension == "part" {
          let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date.distantPast
          if modified < cutoff { try? FileManager.default.removeItem(at: url) }
          continue
        }
        if keep.contains(url.path) || referenced.contains(url.path) { continue }
        try? FileManager.default.removeItem(at: url)
      }
    }
  }
}
