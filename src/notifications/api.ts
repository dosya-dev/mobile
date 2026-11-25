import { apiRequest } from "@/api";
import type { NotificationChannel, NotificationGroup } from "./groups";
import type { InboxItem, InboxSummary } from "./inbox";

export interface NotificationSettings {
  /**
   * The settings screen as the server describes it: 14 groups with labels,
   * descriptions and their effective values. The client holds no copy of this
   * list - see groups.ts for what used to be there and why it is gone.
   */
  groups: NotificationGroup[];
  channels: Record<string, boolean>;
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const res = await apiRequest<{ ok: true } & NotificationSettings>("/api/me/notifications");
  return { groups: res.groups ?? [], channels: res.channels };
}

/** PUT accepts partial maps; unknown keys are ignored server-side. */
export async function setNotificationPreference(key: string, value: boolean): Promise<void> {
  await apiRequest<{ ok: true }>("/api/me/notifications", {
    method: "PUT",
    body: { preferences: { [key]: value } },
  });
}

export async function setNotificationChannel(key: NotificationChannel, value: boolean): Promise<void> {
  await apiRequest<{ ok: true }>("/api/me/notifications", {
    method: "PUT",
    body: { channels: { [key]: value } },
  });
}

export async function registerPushDevice(token: string, platform: "ios" | "android", deviceName?: string): Promise<void> {
  await apiRequest<{ ok: true }>("/api/notifications/push/register-device", {
    method: "POST",
    body: { token, platform, device_name: deviceName },
  });
}

export async function unregisterPushDevice(token: string): Promise<void> {
  await apiRequest<{ ok: true }>("/api/notifications/push/register-device", {
    method: "DELETE",
    body: { token },
  });
}

// ── Inbox ───────────────────────────────────────────────────
// Distinct from the preference calls above: those are /api/me/notifications
// (what the user wants to be told about), these are /api/notifications (what
// they have actually been told). The two used to share a route name on mobile,
// which is why the preferences screen moved to /notification-settings.

export interface InboxPage {
  items: InboxItem[];
  /** Cursor for the next page, or null at the end of the list. */
  nextBefore: number | null;
}

/** `limit` is capped at 50 server-side; `before` is the previous page's nextBefore. */
export async function listNotifications(before?: number | null, limit = 30): Promise<InboxPage> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (before != null) qs.set("before", String(before));
  const res = await apiRequest<{ ok: true; items: InboxItem[]; nextBefore: number | null }>(
    `/api/notifications?${qs.toString()}`,
  );
  return { items: res.items ?? [], nextBefore: res.nextBefore ?? null };
}

export async function getInboxSummary(): Promise<InboxSummary> {
  const res = await apiRequest<{ ok: true } & InboxSummary>("/api/notifications/summary");
  return { unread: res.unread ?? 0, latest: res.latest ?? null };
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiRequest<{ ok: true }>("/api/notifications/read-all", { method: "POST" });
}

export async function dismissNotification(id: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/notifications/${id}/dismiss`, { method: "POST" });
}
