import CoreGraphics
import Foundation
import ImageIO

/// Photo decode for the Personas face reader. Semantics follow
/// apps/web/src/lib/personas-device/ort/decode.ts:
/// - EXIF orientation is NOT applied (CGImageSource returns the stored pixels;
///   the size is read from the header, also unrotated);
/// - 8-bit RGBA in the image's own RGB colour space, NO colour-profile
///   conversion (the web decodes with `colorSpaceConversion: 'none'`); only a
///   non-RGB image (gray, CMYK) is converted, to sRGB;
/// - long side capped at `maxSide` by area averaging (box filter);
/// - more than `maxPixels` pixels is unsupported.
enum DecodeFailure: Error {
  case unsupported(String)
  case failed(String)
}

struct RgbaImage {
  var width: Int
  var height: Int
  var rgba: [UInt8]
}

enum Decode {
  /// The size the reader works at: the photo's own, or `maxSide` on the long side.
  static func workingSize(width: Int, height: Int, maxSide: Int) -> (Int, Int) {
    let long = max(width, height)
    if long <= maxSide { return (width, height) }
    let s = Double(maxSide) / Double(long)
    return (max(1, Int((Double(width) * s).rounded())), max(1, Int((Double(height) * s).rounded())))
  }

  static func decode(_ data: Data, maxSide: Int, maxPixels: Int) throws -> RgbaImage {
    guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          CGImageSourceGetCount(source) > 0 else {
      throw DecodeFailure.failed("not a decodable image")
    }
    guard let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let w = (props[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
          let h = (props[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
          w > 0, h > 0 else {
      throw DecodeFailure.failed("no image size")
    }
    if w * h > maxPixels { throw DecodeFailure.unsupported("photo too large to read (\(w)x\(h))") }
    // No kCGImageSourceCreateThumbnailWithTransform: the stored pixels, unrotated.
    guard let cg = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else {
      throw DecodeFailure.failed("decode failed")
    }
    guard cg.width == w, cg.height == h else {
      throw DecodeFailure.failed("decoded \(cg.width)x\(cg.height), header says \(w)x\(h)")
    }
    var full = [UInt8](repeating: 0, count: w * h * 4)
    let drawn: Bool = full.withUnsafeMutableBytes { buf in
      // Draw in the image's own colour space so CoreGraphics does not colour-match
      // it into sRGB. A non-RGB model (gray, CMYK, ...) cannot back an RGBA context.
      var space = CGColorSpace(name: CGColorSpace.sRGB)
      if let own = cg.colorSpace, own.model == .rgb { space = own }
      guard let space = space,
            let ctx = CGContext(
              data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
            ) else { return false }
      // .copy: replace the buffer's pixels rather than composite over zeros.
      ctx.setBlendMode(.copy)
      ctx.interpolationQuality = .none
      ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    guard drawn else { throw DecodeFailure.failed("no bitmap context") }
    // CGContext cannot hold non-premultiplied RGBA; undo the premultiplication
    // so translucent pixels keep the colour the file stores (opaque ones are untouched).
    full.withUnsafeMutableBufferPointer { p in
      var i = 0
      while i < p.count {
        let a = Int(p[i + 3])
        if a != 255 && a != 0 {
          for c in 0..<3 { p[i + c] = UInt8(min(255, (Int(p[i + c]) * 255 + a / 2) / a)) }
        }
        i += 4
      }
    }
    let (dw, dh) = workingSize(width: w, height: h, maxSide: maxSide)
    if dw == w && dh == h { return RgbaImage(width: w, height: h, rgba: full) }
    return RgbaImage(width: dw, height: dh, rgba: BoxFilter.shrink(full, sw: w, sh: h, dw: dw, dh: dh))
  }
}

/// Area-averaging resize: every destination pixel is the mean of the source
/// area it covers, partial source pixels weighted by the covered fraction.
/// Channels are averaged independently (no alpha weighting), matching a
/// non-premultiplied decode.
enum BoxFilter {
  static func shrink(_ src: [UInt8], sw: Int, sh: Int, dw: Int, dh: Int) -> [UInt8] {
    var out = [UInt8](repeating: 0, count: dw * dh * 4)
    let xs = Double(sw) / Double(dw)
    let ys = Double(sh) / Double(dh)
    var acc = [Double](repeating: 0, count: 4)
    src.withUnsafeBufferPointer { s in
      for dy in 0..<dh {
        let y0 = Double(dy) * ys
        let y1 = min(Double(sh), Double(dy + 1) * ys)
        let iy0 = Int(y0)
        let iy1 = min(sh, Int(y1.rounded(.up)))
        for dx in 0..<dw {
          let x0 = Double(dx) * xs
          let x1 = min(Double(sw), Double(dx + 1) * xs)
          let ix0 = Int(x0)
          let ix1 = min(sw, Int(x1.rounded(.up)))
          acc[0] = 0; acc[1] = 0; acc[2] = 0; acc[3] = 0
          var area = 0.0
          for y in iy0..<iy1 {
            let wy = min(Double(y + 1), y1) - max(Double(y), y0)
            if wy <= 0 { continue }
            var row = (y * sw + ix0) * 4
            for x in ix0..<ix1 {
              let wx = min(Double(x + 1), x1) - max(Double(x), x0)
              if wx > 0 {
                let wgt = wx * wy
                area += wgt
                acc[0] += Double(s[row]) * wgt
                acc[1] += Double(s[row + 1]) * wgt
                acc[2] += Double(s[row + 2]) * wgt
                acc[3] += Double(s[row + 3]) * wgt
              }
              row += 4
            }
          }
          let o = (dy * dw + dx) * 4
          if area > 0 {
            for c in 0..<4 { out[o + c] = UInt8(min(255.0, (acc[c] / area + 0.5).rounded(.down))) }
          }
        }
      }
    }
    return out
  }
}
