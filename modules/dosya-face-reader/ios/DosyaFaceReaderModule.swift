import CommonCrypto
import ExpoModulesCore
import Foundation

/// Native decode and file hash for the Personas face reader (see ../index.ts).
public class DosyaFaceReaderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DosyaFaceReader")

    AsyncFunction("decode") { (bytes: Data, maxSide: Int, maxPixels: Int) throws -> [String: Any] in
      do {
        let img = try Decode.decode(bytes, maxSide: maxSide, maxPixels: maxPixels)
        return ["width": img.width, "height": img.height, "rgba": Data(img.rgba)]
      } catch DecodeFailure.unsupported(let m) {
        throw FaceReaderException(code: "ERR_UNSUPPORTED", message: m)
      } catch DecodeFailure.failed(let m) {
        throw FaceReaderException(code: "ERR_FAILED", message: m)
      }
    }.runOnQueue(DispatchQueue.global(qos: .utility))

    AsyncFunction("sha256File") { (path: String) throws -> String in
      guard let input = InputStream(fileAtPath: path) else {
        throw FaceReaderException(code: "ERR_FAILED", message: "cannot open \(path)")
      }
      input.open()
      defer { input.close() }
      var ctx = CC_SHA256_CTX()
      CC_SHA256_Init(&ctx)
      var buf = [UInt8](repeating: 0, count: 1 << 20)
      while true {
        let n = input.read(&buf, maxLength: buf.count)
        if n < 0 { throw FaceReaderException(code: "ERR_FAILED", message: "read failed: \(path)") }
        if n == 0 { break }
        CC_SHA256_Update(&ctx, buf, CC_LONG(n))
      }
      var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
      CC_SHA256_Final(&digest, &ctx)
      return digest.map { String(format: "%02x", $0) }.joined()
    }.runOnQueue(DispatchQueue.global(qos: .utility))

    // The face models are re-downloadable: keep them (the folder and what is
    // in it) out of iCloud and device backups.
    AsyncFunction("excludeFromBackup") { (path: String) throws in
      var url = URL(fileURLWithPath: path)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      do {
        try url.setResourceValues(values)
      } catch {
        throw FaceReaderException(code: "ERR_FAILED", message: "cannot exclude from backup: \(path)")
      }
    }.runOnQueue(DispatchQueue.global(qos: .utility))

    AsyncFunction("loadModels") { (detectorPath: String, embedderPath: String) throws in
      try Self.sessionCall { try Sessions.load(detectorPath: detectorPath, embedderPath: embedderPath) }
    }.runOnQueue(Sessions.queue)

    AsyncFunction("detect") { (input: Data) throws -> [String: Data] in
      try Self.sessionCall { try Sessions.detect(input) }
    }.runOnQueue(Sessions.queue)

    AsyncFunction("embed") { (input: Data, n: Int) throws -> Data in
      try Self.sessionCall { try Sessions.embed(input, n: n) }
    }.runOnQueue(Sessions.queue)

    AsyncFunction("unloadModels") { () in
      Sessions.unload()
    }.runOnQueue(Sessions.queue)
  }

  private static func sessionCall<T>(_ body: () throws -> T) throws -> T {
    do {
      return try body()
    } catch SessionFailure.noModels {
      throw FaceReaderException(code: "ERR_NO_MODELS", message: "models are not loaded")
    } catch SessionFailure.failed(let m) {
      throw FaceReaderException(code: "ERR_FAILED", message: m)
    }
  }
}

/// Rejected to JS with `code` so index.ts can map it to a FaceReaderError.
final class FaceReaderException: Exception {
  init(code: String, message: String) {
    super.init(name: "FaceReaderException", description: message, code: code)
  }
}
