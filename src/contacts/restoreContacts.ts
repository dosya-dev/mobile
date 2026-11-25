import * as FileSystem from "expo-file-system/legacy";
import { parseVCards } from "./vcard";
import { t } from "@/lib/i18n";
import { addContact, requestContactsPermission } from "./contactsSource";

export interface RestoreResult { added: number; failed: number }

/**
 * Additive restore: parses a local .vcf and adds every contact via expo-contacts.
 * v1 does NOT dedup/merge against the existing address book, so re-restoring the
 * same backup creates duplicates (documented tradeoff).
 */
export async function restoreContacts(localVcfUri: string): Promise<RestoreResult> {
  // Ask for WRITE access up front - otherwise every addContactAsync silently
  // fails and the user just sees "Added 0, N failed" with no OS prompt.
  if (!(await requestContactsPermission())) {
    throw new Error(t("common.error.contactsPermissionWasDenied"));
  }
  const vcf = await FileSystem.readAsStringAsync(localVcfUri);
  const contacts = parseVCards(vcf);
  let added = 0;
  let failed = 0;
  for (const c of contacts) {
    try {
      await addContact(c);
      added += 1;
    } catch {
      failed += 1;
    }
  }
  return { added, failed };
}
