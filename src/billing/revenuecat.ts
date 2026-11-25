import { Platform } from "react-native";
import Constants from "expo-constants";
import Purchases, { PURCHASES_ERROR_CODE, type PurchasesPackage } from "react-native-purchases";
import { getDistributionChannel } from "@/update/runtime";

/**
 * The one place the app talks to RevenueCat. Everything else calls these
 * functions, so "is store billing possible on this build" has a single answer.
 *
 * Identity comes from `identifyBilling` (the dosya user id), never from the
 * SDK's own anonymous ids, so a store purchase is always tied to an account.
 */

export type PurchaseResult =
  | { ok: true }
  | { ok: false; cancelled: boolean; message: string; code?: string };

function apiKey(): string {
  const extra = Constants.expoConfig?.extra as { revenueCat?: { ios?: unknown; android?: unknown } } | undefined;
  const key = Platform.OS === "ios" ? extra?.revenueCat?.ios : extra?.revenueCat?.android;
  return typeof key === "string" ? key : "";
}

/**
 * False on a sideloaded Android build (no Play billing there) and whenever the
 * key for this platform was not baked into the build.
 */
export function storeBillingAvailable(): boolean {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;
  if (Platform.OS === "android" && getDistributionChannel() === "direct") return false;
  return apiKey() !== "";
}

let configured = false;

export async function configureBilling(): Promise<void> {
  if (configured || !storeBillingAvailable()) return;
  configured = true;
  Purchases.configure({ apiKey: apiKey(), appUserID: undefined });
}

export async function identifyBilling(userId: string): Promise<void> {
  if (!storeBillingAvailable()) return;
  await configureBilling();
  await Purchases.logIn(userId);
}

export async function resetBilling(): Promise<void> {
  if (!storeBillingAvailable() || !configured) return;
  try {
    await Purchases.logOut();
  } catch {
    // logOut throws when the current user is already anonymous; that is the
    // state we wanted anyway.
  }
}

export async function fetchOfferings(): Promise<PurchasesPackage[]> {
  if (!storeBillingAvailable()) return [];
  try {
    await configureBilling();
    const offerings = await Purchases.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch {
    return [];
  }
}

export async function purchase(pkg: PurchasesPackage): Promise<PurchaseResult> {
  try {
    await configureBilling();
    await Purchases.purchasePackage(pkg);
    return { ok: true };
  } catch (e) {
    const err = e as { userCancelled?: boolean; code?: unknown; message?: unknown };
    const code = err.code === undefined ? undefined : String(err.code);
    const message = typeof err.message === "string" ? err.message : "Purchase failed";
    const cancelled = err.userCancelled === true || code === String(PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR);
    return code === undefined ? { ok: false, cancelled, message } : { ok: false, cancelled, message, code };
  }
}

export async function restore(): Promise<{ ok: boolean; message?: string; code?: string }> {
  try {
    await configureBilling();
    await Purchases.restorePurchases();
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Restore failed";
    const code = (e as { code?: unknown } | null)?.code;
    return code === undefined ? { ok: false, message } : { ok: false, message, code: String(code) };
  }
}

export async function presentCodeRedemption(): Promise<void> {
  if (Platform.OS !== "ios" || !storeBillingAvailable()) return;
  await configureBilling();
  await Purchases.presentCodeRedemptionSheet();
}
