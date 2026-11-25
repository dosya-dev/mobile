import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { useUploadStore } from "@/upload/store";
import { startUploads } from "@/upload/controller";
import type { UploadItem } from "@/upload/types";
import { resolveContactsFolder } from "@/backup/folders";
import { readAllContacts } from "./contactsSource";
import { serializeVCards } from "./vcard";

const LAST_BACKUP_KEY = "dosya.contacts.lastBackup";

export async function getLastContactsBackupAt(): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(LAST_BACKUP_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function setLastContactsBackupAt(unixSeconds: number): Promise<void> {
  await SecureStore.setItemAsync(LAST_BACKUP_KEY, String(unixSeconds));
}

/** YYYY-MM-DD in local time. */
function todayStamp(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export interface ContactsBackupResult { count: number; fileName: string }

export async function backupContacts(workspaceId: string): Promise<ContactsBackupResult> {
  const contacts = await readAllContacts();
  const vcf = serializeVCards(contacts);

  const fileName = `contacts-${todayStamp()}.vcf`;
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, vcf);

  const info = await FileSystem.getInfoAsync(uri);
  const size = info.exists && !info.isDirectory ? info.size ?? vcf.length : vcf.length;

  const folderId = await resolveContactsFolder(workspaceId);

  const item: UploadItem = {
    id: `ct_${Date.now()}`,
    name: fileName,
    uri,
    size,
    mime: "text/vcard",
    folderId,
    workspaceId,
    status: "queued",
    progress: 0,
  };
  useUploadStore.getState().enqueue([item]);
  startUploads();

  await setLastContactsBackupAt(Math.floor(Date.now() / 1000));
  return { count: contacts.length, fileName };
}

/** Account purge (sign-out): forget the last contacts-backup timestamp. */
export async function clearContactsBackupState(): Promise<void> {
  await SecureStore.deleteItemAsync(LAST_BACKUP_KEY);
}
