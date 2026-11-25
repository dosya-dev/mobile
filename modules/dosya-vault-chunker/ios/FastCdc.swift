import Foundation
import CryptoKit

/// Port of packages/e2ee-core/src/chunker.ts. Every arithmetic step mirrors
/// the TypeScript's uint32 semantics (`>>> 0`) with UInt32 wrapping ops, so
/// the boundaries are byte-identical; CHUNKER_VECTORS pins that on device.
enum FastCdc {
  /// Deterministic 256-entry gear table: xorshift32 from seed 0x9e3779b9.
  static let gear: [UInt32] = {
    var g = [UInt32](repeating: 0, count: 256)
    var s: UInt32 = 0x9e37_79b9
    for i in 0..<256 {
      s ^= s << 13
      s ^= s >> 17
      s ^= s << 5
      g[i] = s
    }
    return g
  }()

  /// SHA-256 over the table as 256 little-endian uint32 (1024 bytes), the
  /// same bytes e2ee-core's CHUNKER_GEAR_SHA256_HEX was computed from.
  static func gearTableSha256Hex() -> String {
    var bytes = [UInt8]()
    bytes.reserveCapacity(1024)
    for v in gear {
      bytes.append(UInt8(v & 0xff))
      bytes.append(UInt8((v >> 8) & 0xff))
      bytes.append(UInt8((v >> 16) & 0xff))
      bytes.append(UInt8((v >> 24) & 0xff))
    }
    return SHA256.hash(data: Data(bytes)).map { String(format: "%02x", $0) }.joined()
  }

  struct Boundary { let offset: Int; let size: Int }

  /// `bits = round(log2(avg))`; JS Math.round rounds half up, which for the
  /// integer-power-of-two averages the app uses never differs from Swift's.
  static func boundaries(of data: Data, min: Int, avg: Int, max: Int) -> [Boundary] {
    let bits = Int((log2(Double(avg))).rounded())
    let maskS: UInt32 = (UInt32(1) << UInt32(Swift.min(31, bits + 2))) &- 1
    let maskL: UInt32 = (UInt32(1) << UInt32(Swift.max(1, bits - 2))) &- 1
    let n = data.count
    var out = [Boundary]()
    var start = 0
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      let p = raw.bindMemory(to: UInt8.self)
      while start < n {
        let hardEnd = Swift.min(start + max, n)
        var fp: UInt32 = 0
        var end = hardEnd
        var i = start
        while i < hardEnd {
          fp = (fp << 1) &+ gear[Int(p[i])]
          let len = i - start + 1
          if len >= min {
            let mask = len < avg ? maskS : maskL
            if fp & mask == 0 { end = i + 1; break }
          }
          i += 1
        }
        out.append(Boundary(offset: start, size: end - start))
        start = end
      }
    }
    return out
  }
}
