import ExpoModulesCore

/// libVLC-backed video playback.
///
/// AVFoundation - and therefore expo-video - has no demuxer for Matroska, AVI,
/// WebM and the rest of the containers in videoSupport.ts's denylist. libVLC
/// carries its own demuxers AND its own decoders, so it also survives codecs
/// AVPlayer refuses even inside containers it does open (HEVC 10-bit profiles,
/// DTS audio, VP9).
///
/// JS treats this module as optional (see src/viewer/vlcPlayer.ts): absent on
/// Android, in Expo Go, and in any dev client built before it existed. Absence
/// falls back to the "save and open in VLC" card, never to a crash.
public class DosyaVlcPlayerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DosyaVlcPlayer")

    View(VlcPlayerView.self) {
      Events("onLoaded", "onProgress", "onEnd", "onError")

      Prop("uri") { (view: VlcPlayerView, uri: String?) in
        view.setUri(uri)
      }

      Prop("paused") { (view: VlcPlayerView, paused: Bool) in
        view.setPaused(paused)
      }

      AsyncFunction("seekTo") { (view: VlcPlayerView, seconds: Double) in
        view.seek(to: seconds)
      }
    }
  }
}
