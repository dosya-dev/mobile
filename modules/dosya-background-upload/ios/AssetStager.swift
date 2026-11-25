import Foundation
import Photos
import CommonCrypto
import UniformTypeIdentifiers

struct StagedResult { let localId: String; let kind: String; let path: String; let size: Int64; let filename: String; let mime: String }
struct StageFailure { let localId: String; let kind: String; let reason: String }

enum AssetStager {
  static let maxBytes: Int64 = 500 * 1024 * 1024
  static let maxFiles = 200

  static func stage(_ requests: [(localId: String, kind: String)], into store: BackgroundUploadStore, done: @escaping ([StagedResult], [StageFailure]) -> Void) {
    var staged: [StagedResult] = []; var failed: [StageFailure] = []
    var usage = store.usage()
    let group = DispatchGroup()
    let lock = NSLock()
    var seenPaths = Set<String>()

    for req in requests {
      lock.lock()
      let overBudget = usage.files >= maxFiles || usage.bytes >= maxBytes
      lock.unlock()
      if overBudget {
        lock.lock(); failed.append(StageFailure(localId: req.localId, kind: req.kind, reason: "budget")); lock.unlock()
        continue
      }
      guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [req.localId], options: nil).firstObject else {
        lock.lock(); failed.append(StageFailure(localId: req.localId, kind: req.kind, reason: "unreadable")); lock.unlock()
        continue
      }
      let resources = PHAssetResource.assetResources(for: asset)
      let wanted: PHAssetResource? = req.kind == "pairedVideo"
        ? resources.first { $0.type == .pairedVideo || $0.type == .fullSizePairedVideo }
        : resources.first { $0.type == .photo || $0.type == .video || $0.type == .fullSizePhoto || $0.type == .fullSizeVideo }
      guard let resource = wanted else {
        lock.lock(); failed.append(StageFailure(localId: req.localId, kind: req.kind, reason: "unreadable")); lock.unlock()
        continue
      }
      let ext = (resource.originalFilename as NSString).pathExtension
      let name = sha1("\(req.localId)|\(req.kind)") + (ext.isEmpty ? "" : ".\(ext)")
      let dest = store.directory.appendingPathComponent(name)

      if !seenPaths.insert(dest.path).inserted {
        // Duplicate (localId, kind) within this request list; the first request's
        // outcome (staged or failed) already covers this destination path.
        continue
      }

      if let size = fileSize(dest), size > 0 {
        // Already staged by a run that was killed before it enqueued.
        lock.lock()
        staged.append(StagedResult(localId: req.localId, kind: req.kind, path: dest.path, size: size, filename: resource.originalFilename, mime: mime(for: resource, ext: ext)))
        lock.unlock()
        continue
      }

      // Export to a .part sibling and only move it into place on full success, so a
      // kill mid-export never leaves a truncated file at the path future runs reuse.
      let part = dest.appendingPathExtension("part")
      try? FileManager.default.removeItem(at: part)
      try? FileManager.default.removeItem(at: dest)
      let options = PHAssetResourceRequestOptions(); options.isNetworkAccessAllowed = true

      // writeData is asynchronous; without serialising, every request in a batch
      // would be issued before any completion runs, so the budget check above
      // would never see an updated usage. Block this thread on each request's
      // completion before moving to the next one.
      let semaphore = DispatchSemaphore(value: 0)
      group.enter()
      PHAssetResourceManager.default().writeData(for: resource, toFile: part, options: options) { error in
        defer { semaphore.signal(); group.leave() }
        if let error = error as NSError? {
          try? FileManager.default.removeItem(at: part)
          let reason = isOutOfSpace(error) ? "nospace" : "unreadable"
          lock.lock(); failed.append(StageFailure(localId: req.localId, kind: req.kind, reason: reason)); lock.unlock()
          return
        }
        guard let size = fileSize(part), size > 0 else {
          try? FileManager.default.removeItem(at: part)
          lock.lock(); failed.append(StageFailure(localId: req.localId, kind: req.kind, reason: "empty")); lock.unlock()
          return
        }
        try? FileManager.default.removeItem(at: dest)
        do {
          try FileManager.default.moveItem(at: part, to: dest)
        } catch {
          try? FileManager.default.removeItem(at: part)
          let reason = isOutOfSpace(error as NSError) ? "nospace" : "unreadable"
          lock.lock(); failed.append(StageFailure(localId: req.localId, kind: req.kind, reason: reason)); lock.unlock()
          return
        }
        lock.lock()
        usage.bytes += size; usage.files += 1
        staged.append(StagedResult(localId: req.localId, kind: req.kind, path: dest.path, size: size, filename: resource.originalFilename, mime: mime(for: resource, ext: ext)))
        lock.unlock()
      }
      semaphore.wait()
    }
    group.notify(queue: .global()) { done(staged, failed) }
  }

  private static func isOutOfSpace(_ error: NSError) -> Bool {
    if error.domain == NSPOSIXErrorDomain && error.code == ENOSPC { return true }
    if error.domain == NSCocoaErrorDomain && error.code == NSFileWriteOutOfSpaceError { return true }
    return false
  }

  private static func fileSize(_ url: URL) -> Int64? {
    (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value
  }

  private static func mime(for resource: PHAssetResource, ext: String) -> String {
    if let uti = UTType(resource.uniformTypeIdentifier), let m = uti.preferredMIMEType { return m }
    switch ext.lowercased() {
    case "heic": return "image/heic"; case "jpg", "jpeg": return "image/jpeg"; case "png": return "image/png"
    case "mov": return "video/quicktime"; case "mp4": return "video/mp4"; default: return "application/octet-stream"
    }
  }

  private static func sha1(_ s: String) -> String {
    let data = Array(s.utf8); var digest = [UInt8](repeating: 0, count: Int(CC_SHA1_DIGEST_LENGTH))
    CC_SHA1(data, CC_LONG(data.count), &digest)
    return digest.map { String(format: "%02x", $0) }.joined()
  }
}
