import type * as React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { requireNativeViewManager, requireOptionalNativeModule } from "expo-modules-core";

/**
 * JS face of modules/dosya-vlc-player.
 *
 * The module is OPTIONAL, and absence is normal, not exceptional: Android
 * never builds it (ExoPlayer already demuxes everything in the denylist),
 * Expo Go cannot carry it, and every dev client built before it existed
 * simply does not have it. `isVlcAvailable()` is the one gate; nothing else
 * in the app may import the native view directly, because rendering it in a
 * build that lacks it throws at mount, not at import.
 */

export interface VlcProgressEvent {
  /** Seconds of media time elapsed. */
  time: number;
  /** Total seconds; 0 while unknown (libVLC learns it from the demuxer). */
  duration: number;
  /** 0..1, usable even while duration is still unknown. */
  position: number;
}

export interface VlcViewProps {
  uri: string | null;
  paused: boolean;
  style?: StyleProp<ViewStyle>;
  onLoaded?: (e: { nativeEvent: { duration: number } }) => void;
  onProgress?: (e: { nativeEvent: VlcProgressEvent }) => void;
  onEnd?: () => void;
  onError?: (e: { nativeEvent: { message: string } }) => void;
}

/** Imperative surface exposed on the native view's ref. */
export interface VlcViewRef {
  seekTo(seconds: number): Promise<void>;
}

export type VlcViewComponent = React.ComponentType<
  VlcViewProps & { ref?: React.Ref<VlcViewRef> }
>;

let available: boolean | null = null;
let cachedView: VlcViewComponent | null = null;

export function isVlcAvailable(): boolean {
  if (available == null) available = requireOptionalNativeModule("DosyaVlcPlayer") != null;
  return available;
}

/**
 * The native view, or null when this build has no libVLC. Resolved lazily so
 * merely importing this file never touches the native registry on Android.
 */
export function vlcVideoView(): VlcViewComponent | null {
  if (!isVlcAvailable()) return null;
  if (!cachedView) {
    cachedView = requireNativeViewManager<VlcViewProps>("DosyaVlcPlayer") as VlcViewComponent;
  }
  return cachedView;
}
