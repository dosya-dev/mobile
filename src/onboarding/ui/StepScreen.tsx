import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { fonts } from "@/theme/fonts";
import { useT } from "@/lib/i18n";
import { localDigits } from "@/lib/format-locale";

// expo-linear-gradient isn't a dependency of this app, so the scroll-to-footer
// fade is faked with stacked, evenly-spaced bands stepping through the Tailwind
// opacity scale rather than a true gradient. Each band must be a literal class
// name (not built from a template) - NativeWind's scanner reads source text,
// not runtime values, so an interpolated class name never gets generated.
const FADE_BAND_OPACITIES = ["opacity-0", "opacity-20", "opacity-40", "opacity-60", "opacity-80", "opacity-100"];

/**
 * How many steps THIS run of setup actually has, and how many of the frame's
 * absolute step numbers are being skipped ahead of it.
 *
 * The server auto-creates a Personal workspace on every signup path (apps/api
 * 9a3ba8a6, live since 2026-08-02), so the workspace step is skipped for the
 * primary new-user cohort - and a hardcoded "of 4" meant the very first screen
 * a new account ever saw announced "Step 2 of 4" with two bars already filled,
 * for steps it had never been shown. Steps keep their own absolute numbers;
 * this is what maps them onto the sequence being run.
 *
 * The default matches the full four-step sequence, so a step rendered outside
 * a provider (and every existing consumer) is unchanged.
 */
const StepProgressContext = createContext<{ total: number; offset: number }>({ total: 4, offset: 0 });

export function StepProgressProvider({
  total, offset, children,
}: {
  total: number;
  offset: number;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ total, offset }), [total, offset]);
  return <StepProgressContext.Provider value={value}>{children}</StepProgressContext.Provider>;
}

/**
 * The frame every setup step shares: progress, title block, scrolling body,
 * and a pinned footer. Steps own their content and nothing else, so the
 * sequence stays consistent without each step re-deriving it.
 */
export function StepScreen({
  step, title, subtitle, children,
  primaryLabel, onPrimary, primaryLoading = false, primaryDisabled = false,
  secondaryLabel, onSecondary, footnote, testID,
}: {
  step: 1 | 2 | 3 | 4;
  title: string;
  subtitle?: string;
  children: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  footnote?: string;
  testID?: string;
}) {
  // The step's own number is absolute (1..4). What the user is told is its
  // position in the sequence actually being run - see StepProgressContext.
  const t = useT();
  const { total, offset } = useContext(StepProgressContext);
  const shown = Math.min(Math.max(step - offset, 1), total);
  return (
    <SafeAreaView className="flex-1 bg-background" testID={testID}>
      <View
        testID="onboarding-progress"
        accessibilityRole="progressbar"
        accessibilityLabel={t("onboarding.label.stepShownOfTotal", { shown: localDigits(shown), total: localDigits(total) })}
        accessibilityValue={{ min: 1, max: total, now: shown }}
        className="flex-row gap-1.5 px-6 pb-1"
      >
        {Array.from({ length: total }, (_, n) => n + 1).map((i) => (
          <View
            key={i}
            testID={`onboarding-progress-dot-${i}`}
            className={`h-[3px] flex-1 rounded-sm ${i <= shown ? "bg-primary" : "bg-input"}`}
          />
        ))}
      </View>

      {/* flex-1 here (not just contentContainerClassName, which only sizes the
          inner content view) is what makes this fill the space between the
          progress bar and the footer: without it the frame sizes to its own
          content, the footer stops being pinned, and once content exceeds the
          screen height the frame grows past it with native scrolling never
          engaging - overflow with no way to reach the footer below. */}
      <View className="flex-1">
        <ScrollView
          testID="step-scroll"
          className="flex-1"
          contentContainerClassName="px-6 pb-6 pt-6"
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-2xl font-bold text-foreground" style={{ fontFamily: fonts.bold }}>
            {title}
          </Text>
          {subtitle ? (
            <Text testID="step-subtitle" className="mt-2 text-base leading-6 text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {subtitle}
            </Text>
          ) : null}
          <View className="mt-6">{children}</View>
        </ScrollView>

        {/* Soft fade so content clipped at the footer edge reads as "more below",
            not as a rendering bug. pointerEvents="none" keeps it out of the way
            of the footer's own presses. */}
        <View testID="step-scroll-fade" pointerEvents="none" className="absolute inset-x-0 bottom-0 h-6">
          {FADE_BAND_OPACITIES.map((opacityClass) => (
            <View key={opacityClass} className={`flex-1 bg-background ${opacityClass}`} />
          ))}
        </View>
      </View>

      <View className="px-6 pb-8 pt-3">
        <Button
          title={primaryLabel}
          onPress={onPrimary}
          loading={primaryLoading}
          disabled={primaryDisabled}
          testID="step-primary"
        />
        {onSecondary && secondaryLabel ? (
          <Pressable
            testID="step-secondary"
            accessibilityRole="button"
            accessibilityLabel={secondaryLabel}
            onPress={onSecondary}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            className="mt-3 items-center justify-center py-2"
          >
            <Text className="text-base text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {secondaryLabel}
            </Text>
          </Pressable>
        ) : null}
        {footnote ? (
          <Text testID="step-footnote" className="mt-3 text-center text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {footnote}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
