import ExpoModulesCore
import MobileVLCKit

/// The drawable surface plus the player that renders into it.
///
/// One VLCMediaPlayer per view, created once and fed new media when the uri
/// prop changes. The player streams straight from the presigned URL - nothing
/// is downloaded to disk, so playback costs the same R2 egress the download
/// button would.
///
/// Threading: MobileVLCKit calls its delegate on the main thread, and Expo's
/// EventDispatcher is safe to invoke from there, so there is no queue-hopping
/// in this file. Keep it that way - a background dispatch here is how views
/// half-update.
public final class VlcPlayerView: ExpoView, VLCMediaPlayerDelegate {
  private let player = VLCMediaPlayer()
  private var currentUri: String?
  private var paused = false
  /// onLoaded must fire exactly once per uri: the JS side uses it to stand
  /// down its stall timer and build the seek bar, and a duplicate would reset
  /// a scrub in progress.
  private var reportedLoad = false

  let onLoaded = EventDispatcher()
  let onProgress = EventDispatcher()
  let onEnd = EventDispatcher()
  let onError = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    // The view itself is the drawable; libVLC letterboxes to preserve aspect,
    // which matches the contentFit="contain" the expo-video stage uses.
    player.drawable = self
    player.delegate = self
  }

  func setUri(_ uri: String?) {
    guard uri != currentUri else { return }
    currentUri = uri
    reportedLoad = false
    player.stop()
    guard let uri, let url = URL(string: uri) else { return }
    player.media = VLCMedia(url: url)
    // Autoplay: the user tapped a video in the viewer, and only the active
    // pager page ever resolves a uri, so this cannot fire for a neighbour.
    if !paused { player.play() }
  }

  func setPaused(_ value: Bool) {
    paused = value
    if value {
      if player.isPlaying { player.pause() }
    } else if player.media != nil {
      player.play()
    }
  }

  func seek(to seconds: Double) {
    player.time = VLCTime(int: Int32((seconds * 1000).rounded()))
  }

  /// Stop on window removal, not deinit: React can hold the detached view
  /// briefly, and a stopped player is what releases the decoder and the HTTP
  /// connection immediately when the user swipes to the next file.
  public override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    if newWindow == nil { player.stop() }
  }

  // MARK: - VLCMediaPlayerDelegate

  public func mediaPlayerStateChanged(_ aNotification: Notification) {
    switch player.state {
    case .error:
      onError(["message": "libVLC could not open or decode this stream"])
    case .ended:
      onEnd([:])
    case .playing:
      reportLoadedIfReady()
    default:
      break
    }
  }

  public func mediaPlayerTimeChanged(_ aNotification: Notification) {
    reportLoadedIfReady()
    let lengthMs = player.media?.length.intValue ?? 0
    onProgress([
      "time": Double(player.time.intValue) / 1000.0,
      "duration": Double(max(lengthMs, 0)) / 1000.0,
      "position": Double(player.position),
    ])
  }

  private func reportLoadedIfReady() {
    guard !reportedLoad else { return }
    // Length stays 0 until the demuxer has read enough to know it. Waiting
    // for a real value (or confirmed playback, for length-less streams) means
    // JS gets a duration it can actually build a seek bar from.
    let lengthMs = player.media?.length.intValue ?? 0
    guard lengthMs > 0 || player.isPlaying else { return }
    reportedLoad = true
    onLoaded(["duration": Double(max(lengthMs, 0)) / 1000.0])
  }
}
