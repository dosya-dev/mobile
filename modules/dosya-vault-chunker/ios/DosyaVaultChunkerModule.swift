import ExpoModulesCore
import Foundation

/// Native chunk boundaries for the Vault (see ../index.ts for the contract).
/// The file is memory-mapped, so a multi-gigabyte video never loads into RAM,
/// and the loop runs off the JS thread.
public class DosyaVaultChunkerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DosyaVaultChunker")

    Function("gearTableSha256Hex") { () -> String in
      FastCdc.gearTableSha256Hex()
    }

    AsyncFunction("chunkBoundaries") { (path: String, min: Int, avg: Int, max: Int) throws -> [[String: Int]] in
      guard min > 0, avg >= min, max >= avg else {
        throw ChunkerException(code: "EINVAL", message: "params must satisfy 0 < min <= avg <= max")
      }
      let url = URL(fileURLWithPath: path)
      var isDir: ObjCBool = false
      guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir), !isDir.boolValue else {
        throw ChunkerException(code: "ENOENT", message: "no such file: \(path)")
      }
      guard FileManager.default.isReadableFile(atPath: path) else {
        throw ChunkerException(code: "EACCES", message: "file not readable: \(path)")
      }
      let data: Data
      do {
        data = try Data(contentsOf: url, options: .mappedIfSafe)
      } catch {
        throw ChunkerException(code: "EACCES", message: "could not map file: \(error.localizedDescription)")
      }
      return FastCdc.boundaries(of: data, min: min, avg: avg, max: max).map { ["offset": $0.offset, "size": $0.size] }
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))
  }
}

/// Rejected to JS with `code` so index.ts can map it to a ChunkerError.
/// ExpoModulesCore's `Exception` has `init(name:description:code:)`
/// (ios/Core/Exceptions/Exception.swift); `code` becomes the JS error's code.
final class ChunkerException: Exception {
  init(code: String, message: String) {
    super.init(name: "ChunkerException", description: message, code: code)
  }
}
