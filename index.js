// crypto.getRandomValues / randomUUID for Hermes - must precede every other import.
import "./src/vault/cryptoGlobal";
// Intl.PluralRules fallback for Hermes builds that lack it or ignore the locale.
import "./src/i18n/intl-setup";
import "expo-router/entry";
import { AppRegistry } from "react-native";
import TrackPlayer from "react-native-track-player";
import { playbackService } from "./src/player/service";
import { installCarPlayBrowseScreen } from "./src/incar/browseScreen";
import { installCarPlayNowPlaying } from "./src/incar/nowPlayingScreen";
import { installHistoryHooks } from "./src/incar/historyHooks";
import { installVoiceSearch } from "./src/incar/voice";
import { logIntlProbe } from "./src/i18n/intl-probe";
import { personasHeadlessTask } from "./src/personas/device/background";

// Must be registered at module scope, before any UI mounts - RNTP spawns this
// as a headless task that keeps handling lock-screen events in the background.
TrackPlayer.registerPlaybackService(() => playbackService);

// Android: the Personas WorkManager worker starts this headless task with the
// app closed (modules/dosya-personas-background), so it must be registered at
// module scope, before any UI mounts. Importing ./src/personas/device/background
// also connects the native windows to the runner (definePersonasBackground), so
// a cold background start on either platform listens before native flushes
// the window it buffered.
AppRegistry.registerHeadlessTask("DosyaPersonasRead", () => personasHeadlessTask);

// No-op on Android (isCarPlaySupported() gates it internally). On iOS this
// registers the CarPlay connect/disconnect handlers before any UI mounts, so
// a cold launch straight into a connected car is covered, not just a launch
// from the home screen.
installCarPlayBrowseScreen();
installCarPlayNowPlaying();
installHistoryHooks();
installVoiceSearch();

if (__DEV__) logIntlProbe();
