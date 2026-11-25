import { Platform } from "react-native";
import * as Clipboard from "expo-clipboard";
import { t } from "@/lib/i18n";
import { validateCode, type CouponCheck } from "./api";

/**
 * How Android hands a code to Google Play. Set by the device spike (spec §8,
 * Rollout 4); "none" until it has run, so a Google code is told to use the web
 * or iOS rather than sent somewhere we have not proven works.
 */
export type AndroidRedeemMode = "play_sheet" | "deep_link" | "none";
export const ANDROID_REDEEM_MODE = "none" as AndroidRedeemMode;

export type RedeemResult =
  | { kind: "ios_sheet"; terms: string | null }
  /** An empty `url` (play_sheet mode) means: start the normal purchase of the selected package. */
  | { kind: "android_link"; url: string; terms: string | null }
  | { kind: "web_only" }
  | { kind: "web_ios_only" }
  | { kind: "invalid"; message: string };

export type RedeemDeps = {
  validateCode: (code: string) => Promise<CouponCheck>;
  platform: "ios" | "android";
  androidMode: AndroidRedeemMode;
  setClipboard: (text: string) => Promise<unknown>;
  invalidMessage: string;
};

const defaultDeps = (): RedeemDeps => ({
  validateCode,
  platform: Platform.OS === "ios" ? "ios" : "android",
  androidMode: ANDROID_REDEEM_MODE,
  setClipboard: (text) => Clipboard.setStringAsync(text),
  invalidMessage: t("upgrade.error.invalidCode"),
});

/** Check a code with the server and decide where it can be used. Pure orchestration. */
export async function redeem(code: string, deps: RedeemDeps = defaultDeps()): Promise<RedeemResult> {
  let check: CouponCheck;
  try {
    check = await deps.validateCode(code.trim());
  } catch {
    return { kind: "invalid", message: deps.invalidMessage };
  }
  if (!check.ok) return { kind: "invalid", message: check.error || deps.invalidMessage };
  if (!check.store_code) return { kind: "web_only" };
  if (deps.platform === "ios") {
    // The App Store's redeem sheet asks for the code; we leave it on the clipboard.
    await deps.setClipboard(check.store_code);
    return { kind: "ios_sheet", terms: check.store_terms };
  }
  if (deps.androidMode === "deep_link") {
    return { kind: "android_link", url: `https://play.google.com/redeem?code=${encodeURIComponent(check.store_code)}`, terms: check.store_terms };
  }
  if (deps.androidMode === "play_sheet") return { kind: "android_link", url: "", terms: check.store_terms };
  return { kind: "web_ios_only" };
}
