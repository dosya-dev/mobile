import { Platform } from "react-native";
import { routeIncomingUrl } from "@/share-intent/incoming";

/**
 * expo-router calls this for every URL the app is launched or foregrounded
 * with, before turning it into a route. It is the only hook that can stop a
 * file:// URL - a document opened with dosya.dev on iOS - from rendering
 * "Unmatched Route" over the app. The real behaviour lives in
 * src/share-intent/incoming.ts; this stays a thin adapter so it can be tested
 * without mocking Platform.
 *
 * Returning null keeps the URL out of the router; the destination picker is
 * then opened by useShareIntentRouting off the share-intent store.
 */
export async function redirectSystemPath({ path }: { path: string; initial: boolean }): Promise<string | null> {
  try {
    return await routeIncomingUrl(path, Platform.OS);
  } catch {
    // Never throw from here - expo-router warns it can take the app down. A
    // deep link is worth more than the file-open path's edge cases.
    return path;
  }
}
