import AVKit
import ExpoModulesCore
import Photos
import UIKit

/// Live Photo paired-video extraction.
///
/// expo-media-library only ever surfaces the still image of a Live Photo, so
/// without this the moving half was silently dropped from every backup. The
/// video lives in a separate PHAssetResource, which has no JS binding.
///
/// JS treats this module as optional (see src/backup/livePhoto.ts): absent on
/// Android and in Expo Go, and any failure just means the still is backed up on
/// its own.
public class DosyaMediaExtrasModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DosyaMediaExtras")

    AsyncFunction("livePhotoVideoUri") { (localIdentifier: String, promise: Promise) in
      guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil).firstObject else {
        promise.resolve(nil)
        return
      }
      // Not a Live Photo - the common case, and not an error.
      guard asset.mediaSubtypes.contains(.photoLive) else {
        promise.resolve(nil)
        return
      }
      guard let resource = PHAssetResourceManager.pairedVideoResource(for: asset) else {
        promise.resolve(nil)
        return
      }

      // Write to a stable per-asset path in the caches directory so a retry
      // after a failed upload reuses the same file instead of accumulating
      // copies. Caches is right: the file is disposable once uploaded.
      let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("dosya-live-photos", isDirectory: true)
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let safeName = localIdentifier.replacingOccurrences(of: "/", with: "_")
      let target = dir.appendingPathComponent("\(safeName).mov")
      try? FileManager.default.removeItem(at: target)

      let options = PHAssetResourceRequestOptions()
      options.isNetworkAccessAllowed = true // the original may still be in iCloud

      PHAssetResourceManager.default().writeData(for: resource, toFile: target, options: options) { error in
        if error != nil {
          promise.resolve(nil)
        } else {
          promise.resolve(target.absoluteString)
        }
      }
    }

    /// Offline files (src/offline/store.ts) live in Documents so iOS never
    /// purges them under storage pressure, which also puts them in iCloud and
    /// Finder backups by default. They are a copy of what is on dosya, and a
    /// pinned 20 GB folder must not eat the user's iCloud quota or travel to a
    /// restored phone, so the root directory is excluded (its contents follow).
    /// Resolves with the flag as read back from disk, so JS reports the truth.
    AsyncFunction("setExcludedFromBackup") { (uri: String, excluded: Bool) -> Bool in
      var url = uri.hasPrefix("file://") ? (URL(string: uri) ?? URL(fileURLWithPath: uri)) : URL(fileURLWithPath: uri)
      var values = URLResourceValues()
      values.isExcludedFromBackup = excluded
      try url.setResourceValues(values)
      // setResourceValues caches on the URL instance; read back from a fresh one.
      url.removeAllCachedResourceValues()
      let check = try URL(fileURLWithPath: url.path).resourceValues(forKeys: [.isExcludedFromBackupKey])
      return check.isExcludedFromBackup ?? false
    }

    /// Opens the system AirPlay picker, the same list Control Center shows.
    ///
    /// iOS has no API that presents it from code: the picker only opens from a
    /// tap on an AVRoutePickerView. So one is put in the window, out of sight,
    /// and its button is sent the tap; the picker is a system sheet and does
    /// not need the view to stay visible. Resolves false when there is no
    /// window to host it (the app is in the background).
    AsyncFunction("showAirPlayPicker") { (preferVideo: Bool) -> Bool in
      guard let window = UIApplication.shared.connectedScenes
        .compactMap({ $0 as? UIWindowScene })
        .flatMap({ $0.windows })
        .first(where: { $0.isKeyWindow }) else {
        return false
      }
      let picker = AVRoutePickerView(frame: CGRect(x: -100, y: -100, width: 1, height: 1))
      picker.prioritizesVideoDevices = preferVideo
      picker.alpha = 0.01
      window.addSubview(picker)
      guard let button = picker.subviews.compactMap({ $0 as? UIButton }).first else {
        picker.removeFromSuperview()
        return false
      }
      button.sendActions(for: .touchUpInside)
      // Long enough for the picker to take over; it lives on without the view.
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { picker.removeFromSuperview() }
      return true
    }.runOnQueue(.main)
  }
}

private extension PHAssetResourceManager {
  /// The motion component of a Live Photo. `.fullSizePairedVideo` is present
  /// once the photo has been edited; `.pairedVideo` is the original.
  static func pairedVideoResource(for asset: PHAsset) -> PHAssetResource? {
    let resources = PHAssetResource.assetResources(for: asset)
    return resources.first { $0.type == .fullSizePairedVideo }
      ?? resources.first { $0.type == .pairedVideo }
  }
}
