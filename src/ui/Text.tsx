import { Platform, Text as RNText, StyleSheet, type TextProps } from "react-native";
import { fonts } from "@/theme/fonts";
import { currentLocale } from "@/lib/i18n";
import { layoutIsRtl } from "@/lib/direction";

const ALIGN_CLASS = /(^|\s)text-(left|center|right|justify|start|end)(\s|$)/;

type Props = TextProps & { className?: string };

/**
 * Text that renders in Space Grotesk - the same family the web app uses.
 *
 * Why a wrapper: React Native doesn't cascade `fontFamily`, so there is no global
 * default - every Text must name its family. And because RN can't synthesise a
 * weight from a single-weight face (@expo-google-fonts registers each weight as its
 * own family), the weight has to be resolved to a concrete family name.
 *
 * The weight is read from whichever form is available: a `font-*` utility on the
 * className, or the resolved `fontWeight` if NativeWind already turned className
 * into a style. An explicit `fontFamily` from the caller always wins (e.g. the
 * Space Mono wordmark).
 */
function familyForWeight(weight?: string | number): string {
  const w = String(weight ?? "400");
  if (w === "bold" || w === "700" || w === "800" || w === "900") return fonts.bold;
  if (w === "500" || w === "600") return fonts.medium;
  return fonts.regular;
}

function familyForClassName(className: string): string | null {
  if (/\bfont-(bold|extrabold|black)\b/.test(className)) return fonts.bold;
  if (/\bfont-(medium|semibold)\b/.test(className)) return fonts.medium;
  return null;
}

export function Text({ className, style, ...rest }: Props) {
  const flat = (StyleSheet.flatten(style) ?? {}) as { fontFamily?: string; fontWeight?: string | number; textAlign?: string };
  const family =
    flat.fontFamily ??
    (className ? familyForClassName(className) : null) ??
    familyForWeight(flat.fontWeight);

  // Family first so an explicit caller style still overrides it. Arabic and
  // Persian letters join, so tracking would break the words apart: it goes
  // last and wins. No subscription: a direction change reloads the app, and a
  // he/ar/fa switch re-renders every text anyway. Hebrew keeps its tracking.
  const locale = currentLocale();
  const joined = locale === "ar" || locale === "fa";
  // iOS resolves an unset ("natural") alignment from the app bundle's own
  // localization, which has no right-to-left language, so Arabic, Hebrew and
  // Persian text sat on the left of an RTL screen. React Native turns an
  // explicit "left" into the start side (right) in an RTL layout, so unaligned
  // text gets that, first, where any caller alignment still wins. Android
  // already starts text at the layout's start. Left to right: nothing added.
  const start =
    Platform.OS === "ios" && flat.textAlign === undefined && !(className && ALIGN_CLASS.test(className)) && layoutIsRtl()
      ? { fontFamily: family, textAlign: "left" as const }
      : { fontFamily: family };
  return (
    <RNText
      className={className}
      style={joined ? [start, style, { letterSpacing: 0 }] : [start, style]}
      {...rest}
    />
  );
}
