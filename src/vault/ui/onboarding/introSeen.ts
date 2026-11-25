import { getItem, setItem } from "@/lib/keychain";

/**
 * Whether this phone has been through the Vault intro.
 *
 * Per phone rather than per account: the slides explain the Vault, not
 * anyone's Vault, and a second account on the same phone has already read
 * them. A read failure counts as not seen - showing three slides again is the
 * harmless way to be wrong.
 */
export const VAULT_INTRO_SEEN_KEY = "dosya.vault.introSeen";

export async function readIntroSeen(): Promise<boolean> {
  try {
    return (await getItem(VAULT_INTRO_SEEN_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function markIntroSeen(): Promise<void> {
  try {
    await setItem(VAULT_INTRO_SEEN_KEY, "1");
  } catch {
    // Not remembered means shown again next time, nothing worse.
  }
}
