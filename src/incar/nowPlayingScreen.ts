import TrackPlayer, { Event, State } from "react-native-track-player";
import { isCarPlaySupported, getCarPlayModule } from "./carplayNative";

let pushed = false;

/**
 * NowPlayingTemplate wraps CarPlay's shared native Now Playing screen — it
 * carries no track metadata itself. Title/artist/artwork/progress/transport
 * come entirely from MPNowPlayingInfoCenter/MPRemoteCommandCenter, which RNTP
 * already populates (src/player/metadata/triggers.ts) for the lock screen.
 * This installer only needs to construct the template once and push it when
 * something starts playing.
 */
export function installCarPlayNowPlaying(): void {
  if (!isCarPlaySupported()) return;
  const { CarPlay, NowPlayingTemplate } = getCarPlayModule();

  const template = new NowPlayingTemplate({ upNextButtonEnabled: false, albumArtistButtonEnabled: false });
  CarPlay.enableNowPlaying(true);

  TrackPlayer.addEventListener(Event.PlaybackState, (e) => {
    const playing = e.state === State.Playing || e.state === State.Buffering;
    if (playing && !pushed) {
      pushed = true;
      void CarPlay.pushTemplate(template);
    } else if (!playing) {
      pushed = false;
    }
  });
}
