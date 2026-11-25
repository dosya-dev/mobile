import type { ReactElement } from "react";
import { render, screen, fireEvent, waitFor, configure } from "@testing-library/react-native";

/**
 * Time budget, not behaviour. The first test in this file pays the module init
 * for the whole screen and its query client, which is comfortably under a
 * second in isolation and over five with ~225 suites running in parallel on a
 * saturated machine. Nothing here asserts on speed, so the budget is the wrong
 * thing to be strict about - the same call app/contacts.test.tsx made, for the
 * same reason. No assertion is weakened.
 */
configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(20000);
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationsScreen from "./notification-settings";
import * as api from "@/notifications/api";
import * as push from "@/notifications/push";
import type { NotificationGroup } from "@/notifications/groups";

jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("@/notifications/push", () => ({
  registerForPush: jest.fn(async () => ({ kind: "registered", token: "t" })),
  unregisterForPush: jest.fn(async () => {}),
}));

// gcTime: 0 so the cache doesn't hold a timer open - otherwise jest never exits and
// stalls the whole suite. Cleared after each test for the same reason.
let qc: QueryClient;
function wrap(ui: ReactElement) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0}, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
afterEach(() => qc?.clear());

/**
 * The server describes the screen; this app holds no copy of the list. So the
 * fixture is a server response, and every assertion below is about what the
 * screen did with it - including the exact key it wrote back, which is the
 * half a rendering test cannot see.
 */
const group = (over: Partial<NotificationGroup> = {}): NotificationGroup => ({
  key: "files",
  label: "File activity",
  description: "Uploads, deletions, new versions and locks on files you own.",
  enabled: true,
  alwaysOn: "none",
  note: null,
  options: [],
  ...over,
});

const SETTINGS = {
  groups: [
    group({
      key: "security", label: "Security and sign-in", alwaysOn: "some",
      note: "Some messages in this group are always sent and cannot be switched off.",
    }),
    group({
      key: "files",
      options: [
        { key: "type:files_uploaded", label: "Uploads to your workspace", description: "Off unless you ask for it.", enabled: false },
      ],
    }),
    // The group the three mobile-only toggles folded into.
    group({ key: "sync", label: "Sync and backup", description: "Sync failures, stopped devices, conflicts and phone backup." }),
    group({ key: "product", label: "Product updates", enabled: false }),
  ],
  channels: { in_app: true, email: true, push: false },
};

beforeEach(() => {
  jest.spyOn(api, "getNotificationSettings").mockResolvedValue(SETTINGS as never);
  jest.spyOn(api, "setNotificationPreference").mockResolvedValue(undefined);
  jest.spyOn(api, "setNotificationChannel").mockResolvedValue(undefined);
});

it("renders the delivery channels and one row per group the server sent", async () => {
  wrap(<NotificationsScreen />);
  await waitFor(() => expect(screen.getByTestId("channel-in_app")).toBeTruthy());
  expect(screen.getByTestId("channel-email")).toBeTruthy();
  expect(screen.getByTestId("channel-push")).toBeTruthy();
  for (const key of ["security", "files", "sync", "product"]) {
    expect(screen.getByTestId(`notif-group-${key}`)).toBeTruthy();
  }
  // Labels come from the response, not from this app.
  expect(screen.getByText("Security and sign-in")).toBeTruthy();
});

/**
 * The divergence this closes. backup_completed, backup_failed and
 * sync_conflict were rendered by this app and by nothing else - web had never
 * heard of them - and all three are the `sync` group now.
 */
it("folds the three mobile-only toggles into the sync group", async () => {
  wrap(<NotificationsScreen />);
  await waitFor(() => expect(screen.getByTestId("pref-sync")).toBeTruthy());
  expect(screen.queryByTestId("pref-backup_completed")).toBeNull();
  expect(screen.queryByTestId("pref-backup_failed")).toBeNull();
  expect(screen.queryByTestId("pref-sync_conflict")).toBeNull();
  expect(screen.getByText(/phone backup/)).toBeTruthy();
});

it("reflects server values, including a disabled one", async () => {
  wrap(<NotificationsScreen />);
  await waitFor(() => expect(screen.getByTestId("pref-product").props.value).toBe(false));
  expect(screen.getByTestId("pref-security").props.value).toBe(true);
});

it("saves a group toggle under the group's own key", async () => {
  wrap(<NotificationsScreen />);
  await waitFor(() => expect(screen.getByTestId("pref-product")).toBeTruthy());
  fireEvent(screen.getByTestId("pref-product"), "valueChange", true);
  await waitFor(() => expect(api.setNotificationPreference).toHaveBeenCalledWith("product", true));
});

it("saves an opt-in sub-switch under its own key, not its group's", async () => {
  wrap(<NotificationsScreen />);
  await waitFor(() => expect(screen.getByTestId("pref-type:files_uploaded")).toBeTruthy());
  expect(screen.getByTestId("pref-type:files_uploaded").props.value).toBe(false);
  fireEvent(screen.getByTestId("pref-type:files_uploaded"), "valueChange", true);
  await waitFor(() => expect(api.setNotificationPreference).toHaveBeenCalledWith("type:files_uploaded", true));
});

it("says which groups send regardless of the switch", async () => {
  wrap(<NotificationsScreen />);
  await waitFor(() => expect(screen.getByTestId("notif-group-security")).toBeTruthy());
  expect(screen.getByText(/always sent and cannot be switched off/)).toBeTruthy();
});

it("registers the device when push is switched on", async () => {
  wrap(<NotificationsScreen />);
  await waitFor(() => expect(screen.getByTestId("channel-push")).toBeTruthy());
  fireEvent(screen.getByTestId("channel-push"), "valueChange", true);
  await waitFor(() => expect(api.setNotificationChannel).toHaveBeenCalledWith("push", true));
  await waitFor(() => expect(push.registerForPush).toHaveBeenCalled());
});

it("rolls the switch back when saving fails", async () => {
  jest.spyOn(api, "setNotificationPreference").mockRejectedValue(new Error("nope"));
  wrap(<NotificationsScreen />);
  await waitFor(() => expect(screen.getByTestId("pref-files")).toBeTruthy());
  fireEvent(screen.getByTestId("pref-files"), "valueChange", false);
  await waitFor(() => expect(screen.getByTestId("pref-files").props.value).toBe(true));
});

it("warns that In-app off silences everything (server gates delivery on it)", async () => {
  jest.spyOn(api, "getNotificationSettings").mockResolvedValue({
    ...SETTINGS, channels: { ...SETTINGS.channels, in_app: false },
  } as never);
  wrap(<NotificationsScreen />);
  await waitFor(() => expect(screen.getByTestId("in-app-warning")).toBeTruthy());
});
