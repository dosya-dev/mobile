/**
 * Unit A sweep: activity feed, notifications inbox, notification settings, the
 * bell and the Android channel name, rendered in a language other than English.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import ActivityScreen from "../../../app/activity";
import NotificationsScreen from "../../../app/notifications";
import NotificationSettingsScreen from "../../../app/notification-settings";
import { ActivityEntry } from "../../activity/ActivityEntry";
import { ActivityFilterSheet } from "../../activity/ActivityFilterSheet";
import { ACTION_LABELS, CATEGORY_ACTIONS } from "../../activity/catalog.generated";
import { activityActionLabel, activitySentence } from "../../activity/activityLabels";
import { NotificationBell } from "../../notifications/NotificationBell";
import { CHANNELS } from "../../notifications/groups";
import { listActivity, type ActivityPage, type ActivityRow } from "../../activity/api";
import * as nApi from "../../notifications/api";
import { __resetRemotePushRouting, startRemotePushRouting, DEFAULT_CHANNEL } from "../../notifications/remote";
import * as Notifications from "expo-notifications";
import { loadMessages, t, useLocale, __resetI18nForTests } from "../../lib/i18n";
import {
  captureAlerts, collectTexts, leftoverEnglish, renderInLocale,
} from "../../../test-utils/i18n-sweep";

const mockHeader: { options?: { title?: string; headerRight?: () => ReactElement | null } } = {};
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require("../../../test-utils/i18n-sweep").routerMockWithTitles();
  const baseScreen = base.Stack.Screen;
  const Screen = (props: { options?: typeof mockHeader.options }) => {
    mockHeader.options = props.options;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Children } = require("react");
    return Children.toArray([baseScreen(props), props.options?.headerRight?.() ?? null]);
  };
  return { ...base, Stack: Object.assign(base.Stack, { Screen }) };
});
jest.mock("@/activity/api", () => ({
  ...jest.requireActual("@/activity/api"),
  listActivity: jest.fn(),
}));
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [{ id: "w1" }] }) }));
jest.mock("@/notifications/api", () => ({
  listNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  dismissNotification: jest.fn(),
  getNotificationSettings: jest.fn(),
  setNotificationPreference: jest.fn(),
  setNotificationChannel: jest.fn(),
  getInboxSummary: jest.fn(),
}));
jest.mock("@/notifications/push", () => ({
  registerForPush: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: () => {} })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => {}),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const push = require("@/notifications/push") as { registerForPush: jest.Mock };
const mockList = listActivity as jest.MockedFunction<typeof listActivity>;
const mockNotifs = nApi as unknown as Record<string, jest.Mock>;

const NOW = Math.floor(Date.now() / 1000);

const row = (id: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id, action: "file_uploaded", category: "files",
  entity_type: "file", entity_id: `f_${id}`, resource_name: `${id}.pdf`, entity_name: `${id}.pdf`,
  meta: null, outcome: "success", source: "web", source_ip: null, user_agent: null,
  session_id: null, on_behalf_of: null, obo_name: null,
  user_id: "u1", user_name: "Ada", user_email: "ada@x.com",
  created_at: NOW - 3600, ...over,
});
const MEMBERS = [{ id: "u1", name: "Ada", email: "ada@x.com" }];
const page = (activities: ActivityRow[], over: Partial<ActivityPage> = {}): ActivityPage => ({
  activities, members: MEMBERS, total: activities.length, hasMore: false, ...over,
});

function withQuery(ui: ReactElement): ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const probe: { setPreference: (p: "de" | "en") => Promise<void> } = { setPreference: async () => {} };
function Probe(): null {
  probe.setPreference = useLocale().setPreference as (p: "de" | "en") => Promise<void>;
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetI18nForTests();
  mockHeader.options = undefined;
  mockList.mockResolvedValue(page([row("a1"), row("a2", { action: "member_joined" })]));
  mockNotifs.markAllNotificationsRead.mockResolvedValue(undefined);
  mockNotifs.getInboxSummary.mockResolvedValue({ unread: 3, latest: null });
});

const FULL_ROW = row("full", {
  action: "file_renamed",
  outcome: "denied",
  source: "mobile",
  on_behalf_of: "u9",
  obo_name: "Bob",
  source_ip: "1.2.3.4",
  user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Chrome/120.0",
  session_id: "sess1",
  meta: { old_name: "a", new_name: "b", file_count: 3, via: "api", reason: "no access", geo: { city: "Izmir", country: "TR" } },
});

describe("activity in Turkish", () => {
  it("the feed, its header and its filters have no leftover English", async () => {
    mockList.mockResolvedValue(page([row("a1"), FULL_ROW, row("a3", { action: "weird_code_x" })], { total: 3 }));
    const view = await renderInLocale(withQuery(<ActivityScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("activity-full"));
    expect(screen.getByTestId("activity-detail-full")).toBeTruthy();
    expect(view.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("activity-filter-open"));
    fireEvent.press(screen.getByTestId("activity-filter-members"));
    fireEvent.press(screen.getByTestId("activity-filter-actions"));
    expect(view.leftover()).toEqual([]);
  });

  it("the empty, filtered and failed states have no leftover English", async () => {
    mockList.mockResolvedValue(page([]));
    const view = await renderInLocale(withQuery(<ActivityScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("activity-empty")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
    expect(screen.getByTestId("activity-empty").props.children).not.toBe("Nothing has happened here yet.");
    fireEvent.press(screen.getByTestId("activity-filter-open"));
    fireEvent.press(screen.getByTestId("activity-filter-category-files"));
    fireEvent.press(screen.getByTestId("activity-filter-apply"));
    await waitFor(() => expect(screen.getByTestId("activity-clear-filters")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
  });

  it("a failed next page and the header filter label are translated", async () => {
    mockList
      .mockResolvedValueOnce(page([row("a1")], { total: 2, hasMore: true }))
      .mockRejectedValueOnce(new Error("offline"));
    const view = await renderInLocale(withQuery(<ActivityScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("activity-load-more"));
    await waitFor(() => expect(screen.getByTestId("activity-error")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
  });

  it("an unknown action code shows the server text as sent", async () => {
    await renderInLocale(<ActivityEntry row={row("u1", { action: "weird_code_x" })} now={NOW} />, "tr");
    expect(screen.getByTestId("activity-u1").props.accessibilityLabel).toBe("Ada weird code x u1.pdf");
  });

  it("every action code has a sentence and every filter option a label", async () => {
    const messages = await loadMessages("tr");
    const english = await loadMessages("en");
    for (const code of Object.keys(ACTION_LABELS)) {
      expect(activitySentence(code, "{actor}", "x")).not.toBeNull();
    }
    for (const list of Object.values(CATEGORY_ACTIONS)) {
      for (const o of list) {
        const label = activityActionLabel(o.value, o.label);
        expect(label).toBe(o.label); // English byte-identical
      }
    }
    // The Turkish file has a different text for each sentence key we use.
    expect(messages["activity.message.actorUploadedHasSubjectSelectTrueSubjectOther"])
      .not.toBe(english["activity.message.actorUploadedHasSubjectSelectTrueSubjectOther"]);
  });
});

describe("activity: the English stays byte-identical", () => {
  it("count, filter label and the sentence", async () => {
    await renderInLocale(withQuery(<ActivityScreen />), "en");
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    expect(screen.getByTestId("activity-count").props.children).toBe("2 activities");
    expect(screen.getByTestId("activity-a1").props.accessibilityLabel).toBe("Ada uploaded a1.pdf");
    expect(screen.getByTestId("activity-a2").props.accessibilityLabel).toBe("Ada joined a2.pdf");
    expect(screen.getByLabelText("Filter activity")).toBeTruthy();
    expect(screen.getByText("Filter")).toBeTruthy();
  });
});

describe("activity in Polish plurals", () => {
  it.each([[1, "1 aktywność"], [3, "3 aktywności"], [5, "5 aktywności"]])("total %i", async (n, _text) => {
    mockList.mockResolvedValue(page([row("a1")], { total: n }));
    await renderInLocale(withQuery(<ActivityScreen />), "pl");
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    const shown = String(screen.getByTestId("activity-count").props.children);
    const messages = await loadMessages("pl");
    const msg = messages["activity.description.totalPluralOneActivityOtherActivitiesFilteredSelectTrueFilteredOther"];
    // Polish has one / few / many: the message carries them, and the screen picks by count.
    expect(msg).toMatch(/few|many/);
    expect(shown).toMatch(new RegExp(`^${n} `));
    expect(shown).not.toMatch(/activit/);
    expect(shown).toContain(n === 1 ? "aktywn" : "aktywno");
  });
});

describe("activity switch while mounted", () => {
  it("English, then German in place (feed and open sheet)", async () => {
    __resetI18nForTests();
    await renderInLocale(withQuery(<><Probe /><ActivityScreen /></>), "en");
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    expect(screen.getByText("Filter")).toBeTruthy();
    fireEvent.press(screen.getByTestId("activity-filter-open"));
    expect(screen.getByText("Show activity")).toBeTruthy();
    await act(async () => { await probe.setPreference("de"); });
    expect(screen.queryByText("Show activity")).toBeNull();
    expect(screen.queryByText("Filter")).toBeNull();
    expect(leftoverEnglish(collectTexts(), "de")).toEqual([]);
  });
});

describe("filter sheet", () => {
  it("translates the Turkish chips and sections", async () => {
    const view = await renderInLocale(
      <ActivityFilterSheet
        visible
        filters={{ categories: ["files"], actions: ["file_deleted"], userIds: [] }}
        members={[]}
        onApply={() => {}}
        onClose={() => {}}
      />,
      "tr",
    );
    fireEvent.press(screen.getByTestId("activity-filter-members"));
    expect(view.leftover()).toEqual([]);
    expect(screen.getByText(t("activity.description.noMembersToFilterBy"))).toBeTruthy();
  });
});

const item = (over: Record<string, unknown> = {}) => ({
  id: "n1", kind: "personal", type: "files_uploaded", category: "files",
  priority: "normal", title: "A file arrived", body: "body text", icon: null,
  link_path: null, actions: null, actor_name: "Ada", created_at: NOW - 120, read_at: null, dismissed_at: null,
  ...over,
});

describe("notifications inbox", () => {
  beforeEach(() => {
    mockNotifs.listNotifications.mockResolvedValue({
      items: [
        item({ id: "a", actions: JSON.stringify([{ handler: "dismiss", label: "Hide forever" }]) }),
        item({ id: "b", read_at: 5, created_at: NOW - 3 * 86400 }),
      ],
      nextBefore: null,
    });
  });

  it("title, mark-all, day headers, time and dismiss label in Turkish", async () => {
    const view = await renderInLocale(withQuery(<NotificationsScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("notification-a")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
    expect(screen.getByTestId("screen-title").props.children).not.toBe("Notifications");
    expect(screen.getByTestId("mark-all-read")).toBeTruthy();
    expect(screen.getByTestId("dismiss-a").props.accessibilityLabel).not.toBe("Dismiss A file arrived");
    expect(screen.getByText("Hide forever")).toBeTruthy(); // server action label, as sent
  });

  it("empty state in Turkish", async () => {
    mockNotifs.listNotifications.mockResolvedValue({ items: [], nextBefore: null });
    const view = await renderInLocale(withQuery(<NotificationsScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("inbox-empty")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
  });

  it("the mark-all failure message is translated", async () => {
    mockNotifs.markAllNotificationsRead.mockRejectedValue(new Error("x"));
    const alerts = captureAlerts();
    await renderInLocale(withQuery(<NotificationsScreen />), "tr");
    await waitFor(() => expect(mockHeader.options?.headerRight?.()).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("mark-all-read")).toBeTruthy());
    fireEvent.press(screen.getByTestId("mark-all-read"));
    await waitFor(() => expect(alerts.calls.length).toBe(1));
    expect(alerts.calls[0].message).toBe(t("notifications.error.couldNotMarkAllRead"));
    expect(alerts.calls[0].message).not.toBe("Could not mark all read");
    alerts.restore();
  });

  it("English unchanged", async () => {
    await renderInLocale(withQuery(<NotificationsScreen />), "en");
    await waitFor(() => expect(screen.getByTestId("notification-a")).toBeTruthy());
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Earlier")).toBeTruthy();
    expect(screen.getByText("2m · Ada")).toBeTruthy();
    expect(screen.getByTestId("dismiss-a").props.accessibilityLabel).toBe("Dismiss A file arrived");
    expect(screen.getByText("Mark all read")).toBeTruthy();
  });

  it("switch while mounted: English then German in place, group headers included", async () => {
    __resetI18nForTests();
    await renderInLocale(withQuery(<><Probe /><NotificationsScreen /></>), "en");
    await waitFor(() => expect(screen.getByTestId("notification-a")).toBeTruthy());
    expect(screen.getByText("Today")).toBeTruthy();
    await act(async () => { await probe.setPreference("de"); });
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.queryByText("Earlier")).toBeNull();
    expect(screen.queryByText("Mark all read")).toBeNull();
    expect(leftoverEnglish(collectTexts(), "de")).toEqual([]);
  });
});

describe("notification settings", () => {
  const settings = (over: Record<string, unknown> = {}) => ({
    channels: { in_app: true, email: true, push: true },
    groups: [
      { key: "files", label: "File activity", description: "Server text", enabled: true, alwaysOn: "all", note: null, options: [] },
      { key: "sync", label: "Sync", description: "More server text", enabled: true, alwaysOn: "none", note: "A note", options: [] },
    ],
    ...over,
  });

  it("renders in Turkish with no leftover English", async () => {
    mockNotifs.getNotificationSettings.mockResolvedValue(settings({ channels: { in_app: false, email: true, push: true } }));
    const view = await renderInLocale(withQuery(<NotificationSettingsScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("channel-in_app")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
    expect(screen.getByTestId("in-app-warning")).toBeTruthy();
    expect(screen.getByText("File activity")).toBeTruthy(); // server text as sent
  });

  it("the load error and Retry are translated", async () => {
    mockNotifs.getNotificationSettings.mockRejectedValue(new Error("x"));
    const view = await renderInLocale(withQuery(<NotificationSettingsScreen />), "tr");
    await waitFor(() => expect(screen.getByText(t("notification-settings.error.couldnTLoadNotificationSettings"))).toBeTruthy());
    expect(view.leftover()).toEqual([]);
  });

  it("the save fallback and the OS-permission message are translated", async () => {
    mockNotifs.getNotificationSettings.mockResolvedValue(settings());
    mockNotifs.setNotificationChannel.mockRejectedValueOnce("not an Error");
    const alerts = captureAlerts();
    await renderInLocale(withQuery(<NotificationSettingsScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("channel-email")).toBeTruthy());
    fireEvent(screen.getByTestId("channel-email"), "valueChange", false);
    await waitFor(() => expect(alerts.calls.length).toBe(1));
    expect(alerts.calls[0].message).toBe(t("common.error.couldnTSaveTryAgain"));
    mockNotifs.setNotificationChannel.mockResolvedValue(undefined);
    push.registerForPush.mockResolvedValue({ kind: "denied" });
    fireEvent(screen.getByTestId("channel-push"), "valueChange", false);
    fireEvent(screen.getByTestId("channel-push"), "valueChange", true);
    await waitFor(() => expect(alerts.calls.length).toBe(2));
    expect(alerts.calls[1].message).toBe(t("notification-settings.error.enableNotificationsForDosyaDevInSettings"));
    alerts.restore();
  });

  it("English unchanged", async () => {
    mockNotifs.getNotificationSettings.mockResolvedValue(settings());
    await renderInLocale(withQuery(<NotificationSettingsScreen />), "en");
    await waitFor(() => expect(screen.getByTestId("channel-in_app")).toBeTruthy());
    expect(CHANNELS.map((c) => c.key)).toEqual(["in_app", "email", "push"]);
    for (const text of [
      "In-app", "Show notifications in your inbox.", "Email", "Send notifications to your email address.",
      "Push notifications", "Send alerts to this device.",
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByText("Always on")).toBeTruthy();
    expect(screen.getByText("What you hear about")).toBeTruthy();
    expect(screen.getByText("Delivery")).toBeTruthy();
  });

  it("switch while mounted", async () => {
    __resetI18nForTests();
    mockNotifs.getNotificationSettings.mockResolvedValue(settings());
    await renderInLocale(withQuery(<><Probe /><NotificationSettingsScreen /></>), "en");
    await waitFor(() => expect(screen.getByTestId("channel-in_app")).toBeTruthy());
    expect(screen.getByText("Delivery")).toBeTruthy();
    await act(async () => { await probe.setPreference("de"); });
    expect(screen.queryByText("Delivery")).toBeNull();
    expect(screen.queryByText("In-app")).toBeNull();
    expect(leftoverEnglish(collectTexts(), "de")).toEqual([]);
  });
});

describe("bell", () => {
  it("label with a count in Turkish, plain label, English unchanged", async () => {
    await renderInLocale(withQuery(<NotificationBell />), "tr");
    await waitFor(() => expect(screen.getByTestId("notification-badge")).toBeTruthy());
    expect(screen.getByTestId("open-notifications").props.accessibilityLabel)
      .toBe(t("common.accessibility.notificationsUnreadUnread", { unread: 3 }));
    expect(screen.getByTestId("open-notifications").props.accessibilityLabel).not.toBe("Notifications, 3 unread");
  });

  it("English", async () => {
    __resetI18nForTests();
    await renderInLocale(withQuery(<NotificationBell />), "en");
    await waitFor(() => expect(screen.getByTestId("notification-badge")).toBeTruthy());
    expect(screen.getByTestId("open-notifications").props.accessibilityLabel).toBe("Notifications, 3 unread");
  });
});

describe("android channel name", () => {
  const original = Platform.OS;
  beforeEach(() => { Platform.OS = "android"; __resetRemotePushRouting(); });
  afterEach(() => { Platform.OS = original; });

  it("is created in the current language and re-set when the language changes", async () => {
    __resetI18nForTests();
    const messages = await loadMessages("de");
    const create = Notifications.setNotificationChannelAsync as jest.Mock;
    startRemotePushRouting();
    expect(create).toHaveBeenLastCalledWith(DEFAULT_CHANNEL, expect.objectContaining({ name: "Notifications" }));
    await renderInLocale(<Probe />, "en");
    create.mockClear();
    await act(async () => { await probe.setPreference("de"); });
    expect(create).toHaveBeenCalledWith(DEFAULT_CHANNEL, expect.objectContaining({ name: messages["common.label.notifications"] }));
    expect(messages["common.label.notifications"]).not.toBe("Notifications");
  });
});
