import * as Device from "expo-device";
import { listFiles } from "@/files/api";
import { createFolder } from "@/files/mutations";
import { ensureDeviceId } from "@/lib/deviceId";
import { t } from "@/lib/i18n";
import { chooseDeviceFolderName } from "./deviceFolderName";

/** The folder this installation backs up into under "Mobile Backup". */
export async function deviceFolderName(): Promise<string> {
  return chooseDeviceFolderName({
    deviceName: Device.deviceName ?? null,
    modelName: Device.modelName ?? null,
    installationId: await ensureDeviceId(),
  });
}

const cache = new Map<string, string>(); // "ws:path" -> folderId

async function findOrCreate(workspaceId: string, parentId: string | null, name: string): Promise<string> {
  const page = await listFiles({ workspaceId, folderId: parentId, filter: "all", sort: "name_asc", perPage: 500 });
  const existing = page.folders.find((f) => f.name === name);
  if (existing) return existing.id;
  await createFolder(workspaceId, parentId, name);
  // Re-list to get the created folder's id (the create endpoint's response shape isn't relied on).
  const after = await listFiles({ workspaceId, folderId: parentId, filter: "all", sort: "name_asc", perPage: 500 });
  const made = after.folders.find((f) => f.name === name);
  if (!made) throw new Error(t("common.error.failedToResolveFolderName", { name }));
  return made.id;
}

export async function resolveBackupFolder(workspaceId: string, captureUnixSeconds: number): Promise<string> {
  const d = new Date(captureUnixSeconds * 1000);
  // Local time, not UTC. A 9am 1 January photo in Sydney or Istanbul is still
  // 31 December in UTC, and the previous version filed it under the wrong
  // month (and wrong year). Existing UTC-bucketed folders stay where they are:
  // findOrCreate is idempotent by name, so nothing orphans and no migration runs.
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const segments = ["Mobile Backup", await deviceFolderName(), "Camera Roll", yyyy, mm];

  let parentId: string | null = null;
  let pathKey = workspaceId;
  for (const name of segments) {
    pathKey += `/${name}`;
    const cached = cache.get(pathKey);
    if (cached) { parentId = cached; continue; }
    const id = await findOrCreate(workspaceId, parentId, name);
    cache.set(pathKey, id);
    parentId = id;
  }
  return parentId as string;
}

// Read-only lookup of the contacts backup folder chain. Unlike
// resolveContactsFolder (find-or-create), this NEVER creates folders - used by
// the restore path so tapping "Restore" on a fresh account doesn't leave empty
// Mobile Backup/<device>/Contacts folders behind. Returns null if the backup
// was never made.
//
// Restore is used on a NEW phone or after a reinstall far more than on the
// phone that made the backup, and both mint a new installation id, so this
// installation's own folder is the one place the backup is least likely to
// be. Every device folder under "Mobile Backup" is a candidate: this one
// first, then the name used before folders were per installation (the bare
// "iPhone" every un-entitled phone reported), then any other device, by name.
export async function findContactsFolder(workspaceId: string): Promise<string | null> {
  const root = await listFiles({ workspaceId, folderId: null, filter: "all", sort: "name_asc", perPage: 500 });
  const top = root.folders.find((f) => f.name === "Mobile Backup");
  if (!top) return null;
  const devices = await listFiles({ workspaceId, folderId: top.id, filter: "all", sort: "name_asc", perPage: 500 });
  const current = await deviceFolderName();
  const legacy = Device.deviceName || Device.modelName || "My Phone";
  const ordered = [
    ...devices.folders.filter((f) => f.name === current),
    ...devices.folders.filter((f) => f.name === legacy && f.name !== current),
    ...devices.folders.filter((f) => f.name !== current && f.name !== legacy),
  ];
  for (const device of ordered) {
    const inside = await listFiles({ workspaceId, folderId: device.id, filter: "all", sort: "name_asc", perPage: 500 });
    const contacts = inside.folders.find((f) => f.name === "Contacts");
    if (contacts) return contacts.id;
  }
  return null;
}

export async function resolveContactsFolder(workspaceId: string): Promise<string> {
  const segments = ["Mobile Backup", await deviceFolderName(), "Contacts"];
  let parentId: string | null = null;
  let pathKey = workspaceId;
  for (const name of segments) {
    pathKey += `/${name}`;
    const cached = cache.get(pathKey);
    if (cached) { parentId = cached; continue; }
    const id = await findOrCreate(workspaceId, parentId, name);
    cache.set(pathKey, id);
    parentId = id;
  }
  return parentId as string;
}
