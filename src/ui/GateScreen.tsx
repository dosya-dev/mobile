import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";

/** Below this, a load is fast enough that a spinner would only flash. */
export const SPINNER_AFTER_MS = 450;
/**
 * Above this, the wait has stopped looking like loading and started looking
 * like a hang, so say so and offer a way out.
 *
 * It is deliberately shorter than the network stack's own patience. The API
 * client passes no AbortSignal, so a stalled request runs to NSURLSession's
 * 60-second default, and queryClient then retries it twice - up to about three
 * minutes. Nothing should stare at an unexplained screen for three minutes.
 */
export const STALLED_AFTER_MS = 12_000;

/**
 * What a gate renders while it is deciding what to render.
 *
 * The three gates that guard first run (AppLockGate, OnboardingGate,
 * OnboardingFlow) each used to return a bare `<View className="flex-1
 * bg-background" />` here: an empty screen, with no spinner, no words and no
 * bound on how long it lasts. On a slow or half-open connection that is a blank
 * page that never resolves and never explains itself, which is indistinguishable
 * from a crash - and is what App Review reported against 1.0.0 (16) as "page
 * became unresponsive during onboarding", on an iPad with an active connection.
 *
 * Three states, in order: nothing, spinner, and an honest stall with a retry.
 */
export function GateScreen({
  onRetry,
  testID = "gate-screen",
}: {
  /** Omitted when the caller has nothing to re-run; the stall message still shows. */
  onRetry?: () => void;
  testID?: string;
}) {
  const { tokens } = useColorTheme();
  const t = useT();
  const [phase, setPhase] = useState<"quiet" | "spinner" | "stalled">("quiet");

  useEffect(() => {
    const toSpinner = setTimeout(() => setPhase("spinner"), SPINNER_AFTER_MS);
    const toStalled = setTimeout(() => setPhase("stalled"), STALLED_AFTER_MS);
    // Both cleared on unmount: a timer still pending when the gate resolves
    // keeps the jest worker alive past the run (see the 2026-09-04 CI leak)
    // and, in the app, sets state on a component that is gone.
    return () => { clearTimeout(toSpinner); clearTimeout(toStalled); };
  }, []);

  if (phase === "quiet") return <View testID={testID} className="flex-1 bg-background" />;

  return (
    <SafeAreaView testID={testID} className="flex-1 items-center justify-center bg-background px-10">
      <ActivityIndicator testID="gate-spinner" size="small" color={tokens.mutedForeground} />
      {phase === "stalled" ? (
        <>
          <Text
            testID="gate-stalled"
            className="mt-5 text-center text-base text-foreground"
            style={{ fontFamily: fonts.medium }}
          >
            {t("common.label.thisIsTakingLongerThanItShould")}
          </Text>
          <Text
            className="mt-2 text-center text-sm leading-5 text-muted-foreground"
            style={{ fontFamily: fonts.regular }}
          >
            {t("common.error.dosyaDevIsNotAnsweringCheckYourConnectionAndTryAgain")}
          </Text>
          {onRetry ? (
            <View className="mt-6 w-full">
              <Button title={t("common.action.tryAgain")} testID="gate-retry" onPress={onRetry} />
            </View>
          ) : null}
        </>
      ) : null}
    </SafeAreaView>
  );
}
