import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { DosyaLogo } from "@/ui/brand-icons";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useAuthStore } from "@/auth/authStore";
import { useT } from "@/lib/i18n";
import { deriveFirstLoadStage, type FirstLoadInputs } from "./firstLoadStage";

/** Anti-flash hold: once shown, the splash stays at least this long. A
 * 120 ms blink of a progress bar reads as a glitch, not as feedback. */
const MIN_DISPLAY_MS = 500;
const FADE_OUT_MS = 250;
/** Past this, the label admits the delay instead of letting the frozen bar
 * imply the app hung. The bar itself never fakes progress it doesn't have. */
const SLOW_AFTER_MS = 8000;

/**
 * The moment between sign-in and the first painted file list. A sibling of
 * WorkspaceSwitchSplash (same background, same entry curve), but determinate:
 * each bar advance is a real signal - profile present, workspace chosen, first
 * listing landed - and the user's own identity fading in is part of the
 * choreography. Mounted once by the root FileBrowser when there is nothing
 * cached to paint; warm relaunches never see it.
 */
export function FirstLoadSplash({
  inputs,
  failed,
  onRetry,
}: {
  inputs: FirstLoadInputs;
  failed: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const user = useAuthStore((s) => s.user);
  const stage = deriveFirstLoadStage(inputs);
  const done = stage.phase === "done";

  const [gone, setGone] = useState(false);
  const [slow, setSlow] = useState(false);
  const reduced = useRef(false);

  const fade = useRef(new Animated.Value(0)).current;
  const zoom = useRef(new Animated.Value(0.75)).current;
  const bar = useRef(new Animated.Value(8)).current;
  const identity = useRef(new Animated.Value(0)).current;
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    // Best-effort: some test environments don't implement this.
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => { reduced.current = v; })
      .catch(() => {});
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.timing(zoom, { toValue: 1, duration: 300, easing: Easing.out(Easing.back(1.5)), useNativeDriver: false }),
    ]).start();
  }, [fade, zoom]);

  // The bar only ever moves forward; a frozen bar on failure keeps its place.
  useEffect(() => {
    if (failed) return;
    Animated.timing(bar, {
      toValue: stage.pct,
      duration: reduced.current ? 0 : 450,
      easing: Easing.out(Easing.exp),
      useNativeDriver: false,
    }).start();
  }, [stage.pct, failed, bar]);

  // Identity fades in (with a 4px rise) the moment the account stage resolves.
  useEffect(() => {
    if (!inputs.hasUser) return;
    Animated.timing(identity, { toValue: 1, duration: reduced.current ? 0 : 250, useNativeDriver: false }).start();
  }, [inputs.hasUser, identity]);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  // Stop in-flight animations at unmount so nothing writes after teardown.
  useEffect(
    () => () => { [fade, zoom, bar, identity].forEach((v) => v.stopAnimation()); },
    [fade, zoom, bar, identity],
  );

  // Completion: hold out the minimum display, fade, then unmount for good.
  useEffect(() => {
    if (!done) return;
    const remaining = Math.max(0, MIN_DISPLAY_MS - (Date.now() - mountedAt.current));
    const fadeTimer = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: reduced.current ? 0 : FADE_OUT_MS, useNativeDriver: false }).start();
    }, remaining);
    const goneTimer = setTimeout(() => setGone(true), remaining + FADE_OUT_MS);
    return () => { clearTimeout(fadeTimer); clearTimeout(goneTimer); };
  }, [done, fade]);

  if (gone) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent testID="first-load-splash">
      <Animated.View className="flex-1 items-center justify-center bg-background" style={{ opacity: fade }}>
        <Animated.View className="flex-row items-center gap-2" style={{ transform: [{ scale: zoom }] }}>
          <DosyaLogo size={30} />
          <Text className="text-lg text-foreground" style={{ fontFamily: fonts.mono, fontStyle: "italic" }}>
            dosya.dev
          </Text>
        </Animated.View>

        {/* Reserved height whether or not the identity has arrived, so the bar
            below never jumps when the name fades in. */}
        <View className="mt-3 h-10 items-center justify-center">
          {inputs.hasUser && user ? (
            <Animated.View
              testID="first-load-identity"
              className="items-center"
              style={{ opacity: identity, transform: [{ translateY: identity.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}
            >
              <Text className="text-sm text-foreground" style={{ fontFamily: fonts.bold }} numberOfLines={1}>
                {user.name}
              </Text>
              <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }} numberOfLines={1}>
                {user.email}
              </Text>
            </Animated.View>
          ) : null}
        </View>

        <View className="mt-5 h-1 w-36 overflow-hidden rounded-full" style={{ backgroundColor: tokens.border }}>
          <Animated.View
            className="h-full rounded-full"
            style={{
              backgroundColor: failed ? tokens.destructive : tokens.primary,
              width: bar.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }),
            }}
          />
        </View>

        {failed ? (
          <>
            <Text className="mt-3 text-xs" style={{ fontFamily: fonts.bold, color: tokens.destructive }}>
              {t("files.error.couldnTReachDosyaDev")}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              className="mt-4 rounded-lg bg-primary px-5 py-2"
            >
              <Text className="text-sm text-primary-foreground" style={{ fontFamily: fonts.bold }}>{t("common.retry")}</Text>
            </Pressable>
          </>
        ) : (
          <Text className="mt-3 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {stage.label}
            {/* TODO(catalog): the catalog line is "· slow connection" with one space; the splash read "·  slow connection" with two, which a catalog message cannot hold, so the separator is widened here. */}
            {slow && !done ? `  ${t("files.label.slowConnection").replace("· ", "·  ")}` : ""}
          </Text>
        )}
      </Animated.View>
    </Modal>
  );
}
