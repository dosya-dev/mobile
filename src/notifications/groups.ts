import type { MessageKey } from "@/i18n/keys";

export type NotificationChannel = "in_app" | "email" | "push";

/** The three transports. The table holds message keys; the screen produces the text at render. */
export const CHANNELS: { key: NotificationChannel; labelKey: MessageKey; descKey: MessageKey }[] = [
  { key: "in_app", labelKey: "common.label.inApp", descKey: "common.description.showNotificationsInYourInbox" },
  { key: "email", labelKey: "common.label.email", descKey: "common.description.sendNotificationsToYourEmailAddress" },
  { key: "push", labelKey: "common.label.pushNotifications", descKey: "common.description.sendAlertsToThisDevice" },
];

/**
 * The preference groups themselves are NOT declared here.
 *
 * They used to be: 22 legacy type keys, this app's own copy of web's list plus
 * a "Backup & Sync" section web never had. Every one of them named a
 * preference the server stopped storing at migration 0112, and the divergence
 * from web was invisible to both - two hard-coded lists cannot disagree
 * loudly. `getNotificationSettings` returns the 14 groups with their labels,
 * their descriptions and their current values, and the screen renders that.
 *
 * The three toggles this app carried alone - backup_completed, backup_failed
 * and sync_conflict - all fold into the `sync` group, so nothing is lost.
 *
 * The channel switches above stay client-side: they are three fixed
 * transports, and the phrasing ("Send alerts to this device") is about this
 * handset rather than about the account.
 */
export interface NotificationGroupOption {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface NotificationGroup {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  /** "all" and "some" mean the group contains types that ignore the switch. */
  alwaysOn: "all" | "some" | "none";
  note: string | null;
  options: NotificationGroupOption[];
}
