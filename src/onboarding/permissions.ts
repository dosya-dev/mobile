import * as MediaLibrary from "expo-media-library";
import { isPhotoAccessLimited } from "@/backup/scanner";

export type PhotoPermission = "granted" | "limited" | "denied";

/**
 * The ONE permission first run asks for, and only after the user has read the
 * rationale on PhotoAccessStep. iOS shows this dialog once per install, so it
 * must never fire off a screen the user has not read.
 *
 * Contacts is deliberately NOT here. Contacts backup is a secondary .vcf
 * feature and asks for itself, in context, from the Contacts screen. Adding it
 * back to first run is a regression - see the guard in permissions.test.ts.
 */
export async function requestPhotoAccess(): Promise<PhotoPermission> {
  try {
    const res = await MediaLibrary.requestPermissionsAsync();
    if (!res.granted) return "denied";
    return (await isPhotoAccessLimited()) ? "limited" : "granted";
  } catch {
    return "denied";
  }
}
