import type { ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";

/**
 * The page every Vault first-run screen sits on: a top row (back on the
 * start side, an optional action on the end side, an optional step label in
 * the middle), the content, and the main button pinned to the bottom.
 *
 * The tab bar is held away while these are up (see tabBarHold.ts), so this
 * pads for the bottom safe area itself.
 */
export function OnboardingFrame(props: {
  onBack?: () => void;
  /** Centred over the top row, e.g. "Step 1 of 2". */
  step?: string;
  /** A text action on the end side of the top row, e.g. Skip. */
  endAction?: { label: string; onPress: () => void; testID?: string };
  /** Pinned under the content. */
  footer: ReactNode;
  /** Scrolls, for screens with fields; the slides do not need it. */
  scroll?: boolean;
  testID?: string;
  children: ReactNode;
}) {
  const t = useT();
  const { tokens } = useColorTheme();

  const body = props.scroll ? (
    <ScrollView className="flex-1" contentContainerClassName="pb-6" keyboardShouldPersistTaps="handled">
      {props.children}
    </ScrollView>
  ) : (
    <View className="flex-1">{props.children}</View>
  );

  return (
    <SafeAreaView testID={props.testID} className="flex-1 bg-background" edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="h-11 flex-row items-center justify-between px-3">
          {props.onBack ? (
            <Pressable
              testID="onboarding-back"
              accessibilityRole="button"
              accessibilityLabel={t("common.back")}
              onPress={props.onBack}
              className="h-11 w-11 items-center justify-center"
            >
              <Icon name="chevron-back" size={22} color={tokens.foreground} />
            </Pressable>
          ) : (
            <View className="h-11 w-11" />
          )}
          {props.step ? (
            <Text className="text-sm text-muted-foreground" style={{ fontFamily: fonts.medium }}>{props.step}</Text>
          ) : null}
          {props.endAction ? (
            <Pressable
              testID={props.endAction.testID}
              accessibilityRole="button"
              onPress={props.endAction.onPress}
              className="h-11 min-w-11 items-center justify-center px-3"
            >
              <Text className="text-base text-muted-foreground" style={{ fontFamily: fonts.medium }}>{props.endAction.label}</Text>
            </Pressable>
          ) : (
            <View className="h-11 w-11" />
          )}
        </View>
        {body}
        <View className="gap-1.5 px-5 pb-2 pt-3">{props.footer}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The full-width pill every step ends on. */
export function PrimaryPill(props: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: "add";
  testID?: string;
}) {
  const { tokens } = useColorTheme();
  const off = props.disabled || props.loading;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!props.loading }}
      disabled={off}
      onPress={props.onPress}
      className={"h-[54px] flex-row items-center justify-center gap-2 rounded-full " + (props.disabled ? "bg-border" : "bg-primary")}
    >
      {props.loading ? (
        <ActivityIndicator color={tokens.primaryForeground} />
      ) : (
        <>
          {props.icon ? <Icon name={props.icon} size={20} color={props.disabled ? tokens.mutedForeground : tokens.primaryForeground} /> : null}
          <Text
            className={"text-base " + (props.disabled ? "text-muted-foreground" : "text-primary-foreground")}
            style={{ fontFamily: fonts.medium }}
          >
            {props.title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** The quiet second choice under a PrimaryPill. */
export function QuietButton(props: { title: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={props.testID} accessibilityRole="button" onPress={props.onPress} className="h-11 items-center justify-center">
      <Text className="text-base text-muted-foreground" style={{ fontFamily: fonts.medium }}>{props.title}</Text>
    </Pressable>
  );
}

/** A screen's title and the line or two under it. */
export function OnboardingHeading(props: { title: string; body: string }) {
  return (
    <View className="gap-2.5">
      <Text accessibilityRole="header" className="text-3xl leading-tight text-foreground" style={{ fontFamily: fonts.bold }}>
        {props.title}
      </Text>
      <Text className="text-base leading-6 text-muted-foreground">{props.body}</Text>
    </View>
  );
}

/** The "step n of 2" bar under the top row. */
export function StepBar(props: { index: number; count: number }) {
  return (
    <View className="flex-row gap-1.5 px-5 pt-1.5" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: props.count }, (_, i) => (
        <View key={i} className={"h-1 flex-1 rounded-full " + (i <= props.index ? "bg-primary" : "bg-border")} />
      ))}
    </View>
  );
}
