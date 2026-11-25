import ExpoModulesCore
import UIKit
import VisionKit

/// The system document scanner (the one Notes and Files use), handing back
/// one PDF. VisionKit finds the page edges, flattens the perspective and lets
/// the person retake or add pages; this module only turns the result into a
/// file JS can upload.
///
/// `scan()` resolves `{ uri, pageCount, size }`, or null when the person
/// cancels. Same JS surface as android/.../DosyaDocumentScannerModule.kt.
public class DosyaDocumentScannerModule: Module {
  // VNDocumentCameraViewController holds its delegate weakly, so the module
  // keeps the one live session alive until it ends.
  private var session: ScanSession?

  public func definition() -> ModuleDefinition {
    Name("DosyaDocumentScanner")

    Function("isAvailable") { () -> Bool in
      VNDocumentCameraViewController.isSupported
    }

    AsyncFunction("scan") { (promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else {
        promise.reject("E_UNAVAILABLE", "This device has no document scanner")
        return
      }
      guard self.session == nil else {
        promise.reject("E_BUSY", "A scan is already open")
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("E_NO_VIEW", "Nothing to present the scanner from")
        return
      }
      let session = ScanSession(promise: promise) { [weak self] in self?.session = nil }
      self.session = session
      let camera = VNDocumentCameraViewController()
      camera.delegate = session
      presenter.present(camera, animated: true)
    }.runOnQueue(.main)
  }
}

private final class ScanSession: NSObject, VNDocumentCameraViewControllerDelegate {
  private let promise: Promise
  private let onEnd: () -> Void

  init(promise: Promise, onEnd: @escaping () -> Void) {
    self.promise = promise
    self.onEnd = onEnd
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
    // Pull the pages out on the main thread while the scan object is
    // certainly alive, then do the slow encoding off it.
    let pages = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
    controller.dismiss(animated: true)
    guard !pages.isEmpty else {
      finish { $0.resolve(nil) }
      return
    }
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let url = try PdfWriter.write(pages)
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.doubleValue ?? 0
        self.finish { $0.resolve(["uri": url.absoluteString, "pageCount": pages.count, "size": size]) }
      } catch {
        self.finish { $0.reject("E_PDF", "Could not write the PDF: \(error.localizedDescription)") }
      }
    }
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true)
    finish { $0.resolve(nil) }
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    controller.dismiss(animated: true)
    finish { $0.reject("E_SCAN", error.localizedDescription) }
  }

  private func finish(_ settle: @escaping (Promise) -> Void) {
    DispatchQueue.main.async {
      settle(self.promise)
      self.onEnd()
    }
  }
}

private enum PdfWriter {
  /// A4 width in points. Every page gets it and keeps its own aspect, so a
  /// receipt stays a long strip instead of being squeezed onto a sheet.
  static let pageWidth: CGFloat = 595
  /// 300 dpi across A4's long side: sharp enough to read and print, without
  /// shipping a 12 MP camera frame per page.
  static let maxPixels: CGFloat = 3508
  static let jpegQuality: CGFloat = 0.8

  static func write(_ pages: [UIImage]) throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("scans", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("\(UUID().uuidString).pdf")

    guard let context = CGContext(url as CFURL, mediaBox: nil, nil) else {
      throw NSError(domain: "DosyaDocumentScanner", code: 1, userInfo: [NSLocalizedDescriptionKey: "PDF context"])
    }
    for page in pages {
      try autoreleasepool {
        // Drawing a CGImage built from JPEG data keeps the JPEG stream as is
        // in the PDF, so the file is the size of the JPEGs, not of raw pixels.
        guard let data = downscaled(page).jpegData(compressionQuality: jpegQuality),
              let provider = CGDataProvider(data: data as CFData),
              let image = CGImage(jpegDataProviderSource: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
        else {
          throw NSError(domain: "DosyaDocumentScanner", code: 2, userInfo: [NSLocalizedDescriptionKey: "JPEG encode"])
        }
        let aspect = CGFloat(image.height) / CGFloat(max(image.width, 1))
        var box = CGRect(x: 0, y: 0, width: pageWidth, height: (pageWidth * aspect).rounded())
        context.beginPage(mediaBox: &box)
        context.draw(image, in: box)
        context.endPage()
      }
    }
    context.closePDF()
    return url
  }

  /// Scan images come back upright, so redrawing loses no orientation.
  private static func downscaled(_ image: UIImage) -> UIImage {
    let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
    let longest = max(pixels.width, pixels.height)
    guard longest > maxPixels else { return image }
    let factor = maxPixels / longest
    let target = CGSize(width: (pixels.width * factor).rounded(), height: (pixels.height * factor).rounded())
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: target, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: target))
    }
  }
}
