import * as SecureStore from "expo-secure-store";

const KEY = "dosya.last_method";
export type LastMethod = "google" | "github" | "apple" | "password" | "passkey";

/** The sign-in method used last (drives the "Last used" badge). */
export async function getLastMethod(): Promise<LastMethod | null> {
  const v = await SecureStore.getItemAsync(KEY);
  return v === "google" || v === "github" || v === "apple" || v === "password" || v === "passkey" ? v : null;
}

export async function setLastMethod(m: LastMethod): Promise<void> {
  await SecureStore.setItemAsync(KEY, m);
}
