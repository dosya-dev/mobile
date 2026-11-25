import { Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { GoogleIcon, GithubIcon, AppleIcon } from "./brand-icons";
import { Icon } from "./Icon";
import { fonts } from "@/theme/fonts";
import type { MessageKey } from "@/i18n/keys";
import { useT } from "@/lib/i18n";

// "Sign in with Apple" is the wording Apple's Human Interface Guidelines
// permit (alongside "Sign up with Apple" / "Use with Apple"); "Continue with
// Apple" is NOT one of them, and it also read as a generic consent button
// rather than as the Apple sign-in the user is looking for. Google and GitHub
// carry no such wording rule and stay on the app's own verb.
// Keys, not text: the label is produced at render so it follows the language.
const LABEL: Record<"google" | "github" | "apple" | "passkey", MessageKey> = {
  google: "common.action.continueWithGoogle",
  github: "common.action.continueWithGitHub",
  apple: "common.action.signInWithApple",
  passkey: "sign-in.action.signInWithAPasskey",
};

/**
 * Apple's button is deliberately OUTSIDE the theme.
 *
 * Every other control here is painted from the active palette, and `primary`
 * is the palette's accent - green, amber, pink, blue, depending on which theme
 * the user picked. That turned the one button users identify by its fixed
 * black-and-white livery into a coloured button with a small logo on it, which
 * is both a HIG violation and, more to the point, unrecognisable. So these are
 * literals, not tokens: no theme can repaint them.
 *
 * The hairline is what keeps a black button visible on the near-black
 * backgrounds the dark themes use (#02080e, #090909, #0a0a0a). It is white at
 * low alpha, so on a light background it simply blends into the page.
 */
const APPLE = { bg: "#000000", fg: "#ffffff", border: "rgba(255,255,255,0.24)" } as const;

export function OAuthButton(props: {
  provider: "google" | "github" | "apple" | "passkey";
  onPress: () => void;
  lastUsed?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const { tokens } = useColorTheme();
  const t = useT();
  const isApple = props.provider === "apple";
  // GitHub reads as the dark/filled button, Google as the plain outline - matching web.
  const filled = props.provider === "github";
  return (
    <View className="relative mb-3">
      <Pressable
        testID={props.testID}
        accessibilityRole="button"
        disabled={props.disabled}
        onPress={props.onPress}
        style={isApple ? { backgroundColor: APPLE.bg, borderColor: APPLE.border } : undefined}
        className={
          "h-12 flex-row items-center justify-center gap-2 rounded-lg border " +
          (isApple ? "" : filled ? "border-transparent bg-primary" : "border-border bg-card") +
          (props.disabled ? " opacity-60" : "")
        }
      >
        {props.provider === "google" ? (
          <GoogleIcon size={18} />
        ) : props.provider === "passkey" ? (
          <Icon name="key-outline" size={18} color={tokens.foreground} />
        ) : isApple ? (
          <AppleIcon size={18} color={APPLE.fg} />
        ) : (
          <GithubIcon size={18} color={tokens.primaryForeground} />
        )}
        <Text
          testID={props.testID ? `${props.testID}-label` : undefined}
          style={isApple ? { fontFamily: fonts.medium, color: APPLE.fg } : { fontFamily: fonts.medium }}
          className={(isApple ? "" : filled ? "text-primary-foreground" : "text-foreground") + " text-sm"}
        >
          {t(LABEL[props.provider])}
        </Text>
      </Pressable>
      {props.lastUsed ? (
        <View
          // rtl-ok: centering
          className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5"
        >
          <Text className="text-[10px] text-primary-foreground" style={{ fontFamily: fonts.medium }}>
            {t("common.status.lastUsed")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
