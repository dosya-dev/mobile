import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Image, Pressable, View } from "react-native";
import { useProgress } from "react-native-track-player";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useDownloadStore } from "@/files/downloadStore";
import { useUploadStore } from "@/upload/store";
import { usePlayerStore } from "@/player/playerStore";
import { getForTrack, useMetadataStore } from "@/player/metadata/metadataStore";
import { useVaultActivity } from "@/vault/status";
import { OrbitArc } from "./OrbitArc";
import { orbitState, playbackFraction, type OrbitState } from "./orbitModel";

/**
 * The app's one stateful control.
 *
 * Three surfaces used to fight over the bottom of every Files screen: the `+`
 * on its green disc, the transfer capsule that slid out beside it, and the
 * full-width mini player stacked above both. This is all three. The outer rim
 * reports transfers, the inner rim reports playback position, and the middle
 * morphs between a `+`, a percentage and the current track's artwork.
 *
 * It also retires the tap-to-reveal hack `TransferCapsule` needed. The ring
 * there took the `+`'s place, so a running transfer left nothing to press and
 * a tap had to hand the `+` back for four seconds. Here the press always opens
 * the sheet and the sheet always offers upload, so the button never changes
 * meaning under a thumb that is already moving toward it.
 */
export const ORBIT_SIZE = 56;

/**
 * The disc's one-shot acknowledgement that a transfer just began.
 *
 * It exists because the confirmation dialog that used to say "Uploading 3
 * files…" was removed: it interrupted the person to report something they had
 * just asked for. Feedback is the purpose here - confirming the interface
 * heard the tap - so the disc has to answer for itself, and a percentage
 * quietly replacing a `+` is too easy to miss when your eyes are still on the
 * photo picker dismissing.
 *
 * Kept to a single swell and back. A loop would turn a confirmation into a
 * status light, and the arc already carries the status.
 */
const PULSE_PEAK = 1.12;
const PULSE_OUT_MS = 140;
const PULSE_BACK_MS = 180;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const TRANSFER_STROKE = 3;
const PLAYBACK_STROKE = 2.5;
/** The playback arc sits inside the transfer arc, with a hairline of gap. */
const PLAYBACK_INSET = 7;
/** Matches the old mini player's poll: fast enough to move, slow enough to ignore. */
const POLL_MS = 1000;

export function OrbitButton(props: {
  open: boolean;
  onPress: () => void;
  /**
   * Injectable for tests and for anything that already holds a position. When
   * set, the native poller is never mounted.
   */
  progress?: { position: number; duration: number };
}) {
  // Subscribes to the language: orbitState() builds the accessibility label with the module t.
  useT();
  const { tokens } = useColorTheme();
  const entries = useDownloadStore((s) => s.entries);
  const items = useUploadStore((s) => s.items);
  const track = usePlayerStore((s) => s.queue[s.index] ?? null);
  const playing = usePlayerStore((s) => s.playing);
  // Counts and bytes only, and deliberately not the Vault store: that import
  // would put the 3 MB e2ee bundle on the boot path behind the tab bar.
  const vault = useVaultActivity();
  // Subscribe so a title or artwork that lands after background extraction
  // reaches the disc without waiting for an unrelated re-render.
  useMetadataStore((s) => s.entries);

  // The wave-1 battery rule: no JS timers while the app is backgrounded. With
  // the screen off there is no arc to look at, so the poller is unmounted
  // along with the component that owns it.
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);

  const state = orbitState({
    downloads: Object.values(entries),
    uploads: items,
    hasTrack: !!track,
    // Position is owned by `LivePlaybackArc` below, which is the only thing
    // that polls for it. Nothing here needs it: the core and the label turn on
    // whether a track is LOADED, not on how far through it is.
    position: props.progress?.position ?? 0,
    duration: props.progress?.duration ?? 0,
    vault,
    open: props.open,
  });

  // A single pulse on the rising edge of "something is moving". Watching the
  // boolean rather than the fraction keeps it to one pulse per batch instead of
  // one per progress tick.
  const transferring = state.transfer !== null;
  const pulse = useRef(new Animated.Value(1)).current;
  const wasTransferring = useRef(transferring);
  const reduceMotion = useRef(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (alive) reduceMotion.current = on; })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => {
      reduceMotion.current = on;
    });
    return () => { alive = false; sub.remove(); };
  }, []);

  useEffect(() => {
    const started = transferring && !wasTransferring.current;
    wasTransferring.current = transferring;
    // Reduced motion keeps the arc, which reports progress and is information,
    // and drops the swell, which is only emphasis.
    if (!started || reduceMotion.current) return;
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: PULSE_PEAK,
        duration: PULSE_OUT_MS,
        easing: Easing.bezier(0.23, 1, 0.32, 1),
        useNativeDriver: true,
      }),
      Animated.timing(pulse, {
        toValue: 1,
        duration: PULSE_BACK_MS,
        easing: Easing.bezier(0.23, 1, 0.32, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [transferring, pulse]);

  const artworkUri = track ? getForTrack(track)?.artworkUri ?? null : null;
  const playbackInset = state.transfer !== null ? PLAYBACK_INSET : 1;
  // `useProgress` polls in a bare `setTimeout` loop and has no "off" - passing
  // 0 as the interval spins it as fast as the JS thread allows. The only way
  // to stop it is to unmount the component that calls it, so the live arc is
  // its own component and mounts only when there is something to watch.
  const livePlayback = !!track && appActive && !props.progress;

  return (
    <AnimatedPressable
      testID="orbit-button"
      accessibilityRole="button"
      accessibilityLabel={state.label}
      onPress={props.onPress}
      // A tight, explicit shadow rather than `shadow-lg`. The button sits in a
      // 4px ring of page ground cut out of the tab bar, and `shadow-lg`'s halo
      // is wider than that: it would wash across the ring and smudge the edge
      // that separates the disc from the bar. This lifts the disc without
      // reaching the bar.
      style={{
        width: ORBIT_SIZE,
        height: ORBIT_SIZE,
        elevation: 3,
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 2 },
        transform: [{ scale: pulse }],
      }}
      className="items-center justify-center rounded-full bg-primary"
    >
      {/* The inner hairline, inset from the disc's edge. Kept from the old FAB:
          it is what stops a flat green circle reading as a sticker. */}
      <View
        pointerEvents="none"
        className="absolute rounded-full"
        style={{ top: 4, right: 4, bottom: 4, left: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.42)" }}
      />

      {state.transfer !== null ? (
        <OrbitArc
          testID="orbit-transfer-arc"
          size={ORBIT_SIZE}
          inset={1}
          stroke={TRANSFER_STROKE}
          fraction={state.transfer}
          color={tokens.primaryForeground}
          trackColor="rgba(255,255,255,0.34)"
          animate
        />
      ) : null}

      {state.playback !== null && livePlayback ? (
        <LivePlaybackArc inset={playbackInset} color={tokens.primaryForeground} />
      ) : state.playback !== null ? (
        <OrbitArc
          testID="orbit-playback-arc"
          size={ORBIT_SIZE}
          inset={playbackInset}
          stroke={PLAYBACK_STROKE}
          fraction={state.playback}
          color={tokens.primaryForeground}
          trackColor="rgba(255,255,255,0.28)"
        />
      ) : null}

      <Core state={state} artworkUri={artworkUri} playing={playing} color={tokens.primaryForeground} />
    </AnimatedPressable>
  );
}

/**
 * The playback arc, polling for its own position.
 *
 * Split out for one reason: mounting IS the on switch and unmounting is the
 * off switch. Everything about when it should run is decided by the parent's
 * render, so the battery rule cannot be broken by a prop.
 */
function LivePlaybackArc({ inset, color }: { inset: number; color: string }) {
  const { position, duration } = useProgress(POLL_MS);
  return (
    <OrbitArc
      testID="orbit-playback-arc"
      size={ORBIT_SIZE}
      inset={inset}
      stroke={PLAYBACK_STROKE}
      fraction={playbackFraction(true, position, duration) ?? 0}
      color={color}
      trackColor="rgba(255,255,255,0.28)"
    />
  );
}

function Core(props: { state: OrbitState; artworkUri: string | null; playing: boolean; color: string }) {
  const { state, color } = props;

  if (state.core === "close") {
    return <View testID="orbit-core-close"><Icon name="close" size={26} color={color} /></View>;
  }

  if (state.core === "percent") {
    return (
      <Text testID="orbit-core-percent" style={{ fontFamily: fonts.mono, fontSize: 14, color }}>
        {state.transferPct}
      </Text>
    );
  }

  if (state.core === "artwork") {
    // Both arcs present pushes the artwork in far enough to clear the inner
    // one; a track alone lets it run out to the hairline.
    const inset = state.transfer !== null ? 12 : 7;
    return (
      <View
        testID="orbit-core-artwork"
        pointerEvents="none"
        style={{ position: "absolute", top: inset, right: inset, bottom: inset, left: inset, borderRadius: 999, overflow: "hidden" }}
      >
        {props.artworkUri ? (
          <Image testID="orbit-artwork" source={{ uri: props.artworkUri }} style={{ width: "100%", height: "100%" }} />
        ) : (
          // No artwork extracted yet, or none in the file. A dark disc with a
          // note reads as "a track"; an empty hole reads as a bug.
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} className="items-center justify-center">
            <Icon name="musical-notes" size={14} color={color} />
          </View>
        )}
        <View
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.34)" }}
          className="items-center justify-center"
        >
          <Icon name={props.playing ? "pause" : "play"} size={14} color="#ffffff" />
        </View>
      </View>
    );
  }

  return <View testID="orbit-core-add"><Icon name="add" size={28} color={color} /></View>;
}
