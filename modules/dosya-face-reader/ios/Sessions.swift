import Foundation
import onnxruntime_objc

/// ONNX Runtime 1.29.0 sessions for YuNet and SFace, mirroring
/// apps/web/src/lib/personas-device/ort/models.ts: CPU execution provider,
/// graph optimisation "all", 2 intra-op threads, first input name of each
/// session, first output of SFace. One pair per process; every call runs on
/// `Sessions.queue`, which serialises load, run and unload.
enum SessionFailure: Error {
  case noModels
  case failed(String)
}

enum Sessions {
  // Keep in step with YUNET_OUTPUTS in ../index.ts and Sessions.kt.
  static let yunetOutputs = ["cls_8", "cls_16", "cls_32", "obj_8", "obj_16", "obj_32", "bbox_8", "bbox_16", "bbox_32", "kps_8", "kps_16", "kps_32"]
  static let detectFloats = 3 * 320 * 320
  static let embedFloats = 3 * 112 * 112
  static let embedDim = 128

  static let queue = DispatchQueue(label: "dev.dosya.facereader.sessions", qos: .utility)

  private static var env: ORTEnv?
  private static var detector: ORTSession?
  private static var embedder: ORTSession?
  private static var detectorInput = ""
  private static var embedderInput = ""
  private static var embedderOutput = ""
  private static var loadedPaths: (String, String)?

  private static func options() throws -> ORTSessionOptions {
    let o = try ORTSessionOptions()
    try o.setIntraOpNumThreads(2)
    try o.setGraphOptimizationLevel(.all)
    return o
  }

  /// Idempotent for the same two paths.
  static func load(detectorPath: String, embedderPath: String) throws {
    if let p = loadedPaths, p.0 == detectorPath, p.1 == embedderPath, detector != nil, embedder != nil { return }
    unload()
    do {
      let e = try ORTEnv(loggingLevel: .warning)
      let d = try ORTSession(env: e, modelPath: detectorPath, sessionOptions: try options())
      let have = try d.outputNames()
      let missing = yunetOutputs.filter { !have.contains($0) }
      if !missing.isEmpty { throw SessionFailure.failed("unexpected YuNet outputs, missing \(missing.joined(separator: ", "))") }
      guard let dIn = try d.inputNames().first else { throw SessionFailure.failed("YuNet has no input") }
      let s = try ORTSession(env: e, modelPath: embedderPath, sessionOptions: try options())
      guard let sIn = try s.inputNames().first, let sOut = try s.outputNames().first else {
        throw SessionFailure.failed("SFace has no input or output")
      }
      env = e; detector = d; embedder = s
      detectorInput = dIn; embedderInput = sIn; embedderOutput = sOut
      loadedPaths = (detectorPath, embedderPath)
    } catch let f as SessionFailure {
      unload()
      throw f
    } catch {
      unload()
      throw SessionFailure.failed("load models: \(error.localizedDescription)")
    }
  }

  static func unload() {
    detector = nil; embedder = nil; env = nil; loadedPaths = nil
  }

  private static func tensor(_ data: Data, floats: Int, shape: [Int]) throws -> ORTValue {
    guard data.count == floats * MemoryLayout<Float>.size else {
      throw SessionFailure.failed("input is \(data.count) bytes, expected \(floats * 4)")
    }
    return try ORTValue(tensorData: NSMutableData(data: data), elementType: .float, shape: shape.map { NSNumber(value: $0) })
  }

  /// `tensorData()` wraps the ORTValue's own memory without copying it. Copy the
  /// bytes explicitly, while the ORTValue (and its run result) is alive, so the
  /// returned Data never points into memory ORT may free or reuse.
  private static func copyTensor(_ v: ORTValue) throws -> Data {
    let d = try v.tensorData()
    return Data(bytes: d.bytes, count: d.length)
  }

  static func detect(_ input: Data) throws -> [String: Data] {
    guard let d = detector else { throw SessionFailure.noModels }
    do {
      let x = try tensor(input, floats: detectFloats, shape: [1, 3, 320, 320])
      let r = try d.run(withInputs: [detectorInput: x], outputNames: Set(yunetOutputs), runOptions: nil)
      var out: [String: Data] = [:]
      for k in yunetOutputs {
        guard let v = r[k] else { throw SessionFailure.failed("YuNet output \(k) missing") }
        out[k] = try copyTensor(v)
      }
      return out
    } catch let f as SessionFailure {
      throw f
    } catch {
      throw SessionFailure.failed("detect: \(error.localizedDescription)")
    }
  }

  static func embed(_ input: Data, n: Int) throws -> Data {
    guard let s = embedder else { throw SessionFailure.noModels }
    guard n >= 1 else { throw SessionFailure.failed("embed needs at least one face") }
    do {
      let x = try tensor(input, floats: n * embedFloats, shape: [n, 3, 112, 112])
      let r = try s.run(withInputs: [embedderInput: x], outputNames: [embedderOutput], runOptions: nil)
      guard let v = r[embedderOutput] else { throw SessionFailure.failed("SFace output missing") }
      let out = try copyTensor(v)
      guard out.count == n * embedDim * MemoryLayout<Float>.size else {
        throw SessionFailure.failed("SFace returned \(out.count) bytes for \(n) faces")
      }
      return out
    } catch let f as SessionFailure {
      throw f
    } catch {
      throw SessionFailure.failed("embed: \(error.localizedDescription)")
    }
  }
}
