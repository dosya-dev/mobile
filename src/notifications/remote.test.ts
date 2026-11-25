const mockHandlers: { handleNotification?: (n: unknown) => Promise<unknown> } = {};
const mockResponseListeners: ((r: unknown) => void)[] = [];
let mockLastResponse: unknown = null;
const mockSetChannel = jest.fn(async () => {});
const mockClearLast = jest.fn(async () => { mockLastResponse = null; });
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn((h: typeof mockHandlers) => { mockHandlers.handleNotification = h.handleNotification; }),
  setNotificationChannelAsync: (...a: unknown[]) => mockSetChannel(...(a as [])),
  addNotificationResponseReceivedListener: jest.fn((l: (r: unknown) => void) => {
    mockResponseListeners.push(l);
    return { remove: () => { mockResponseListeners.splice(mockResponseListeners.indexOf(l), 1); } };
  }),
  getLastNotificationResponseAsync: jest.fn(async () => mockLastResponse),
  clearLastNotificationResponseAsync: (...a: unknown[]) => mockClearLast(...(a as [])),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...(a as [])) } }));

// The language store pulls in the keychain and the theme; this test only needs
// the channel name and the language-change hook (the sweep covers the rest).
jest.mock("@/lib/i18n", () => ({
  t: () => "Notifications",
  onLocaleChange: () => () => {},
}));

const mockPlatform = { OS: "ios" as string };
jest.mock("react-native", () => ({ Platform: { get OS() { return mockPlatform.OS; } } }));

import * as Notifications from "expo-notifications";
import {
  startRemotePushRouting, routeColdStartNotification, DEFAULT_CHANNEL, __resetRemotePushRouting,
} from "./remote";

/**
 * A server push carries `data.link_path`, a WEB route (see actionPath.ts).
 * Before this module the only response listener in the app read `data.url` -
 * the key the local backup alerts use - so tapping a remote notification did
 * nothing at all. And with no notification handler installed, a push arriving
 * while the app was open was silently dropped on both platforms.
 */
const response = (data: Record<string, unknown>, identifier = "n1") => ({
  actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
  notification: { request: { identifier, content: { data } } },
});

beforeEach(() => {
  jest.clearAllMocks();
  __resetRemotePushRouting();
  mockResponseListeners.length = 0;
  mockLastResponse = null;
  mockPlatform.OS = "ios";
});

describe("startRemotePushRouting", () => {
  it("shows a push that arrives while the app is in the foreground", async () => {
    startRemotePushRouting();
    expect(Notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    const behaviour = await mockHandlers.handleNotification!({});
    expect(behaviour).toMatchObject({ shouldShowBanner: true, shouldShowList: true });
  });

  it("registers the high-importance channel the server names, on Android only", () => {
    startRemotePushRouting();
    expect(mockSetChannel).not.toHaveBeenCalled();
    __resetRemotePushRouting();
    mockPlatform.OS = "android";
    startRemotePushRouting();
    expect(mockSetChannel).toHaveBeenCalledWith(DEFAULT_CHANNEL, expect.objectContaining({ importance: 4 }));
  });

  it("is idempotent", () => {
    startRemotePushRouting();
    startRemotePushRouting();
    expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
  });

  it("routes a tapped server push through the web-to-mobile path table", () => {
    startRemotePushRouting();
    mockResponseListeners[0](response({ id: "ntf_1", link_path: "/files/abc" }));
    expect(mockPush).toHaveBeenCalledWith("/file/abc");
  });

  it("opens the inbox for a server push whose link has no mobile equivalent", () => {
    startRemotePushRouting();
    // /vault used to be the example here; mobile has a Vault now, so this
    // needs a path the table still has no answer for.
    mockResponseListeners[0](response({ id: "ntf_2", link_path: "/billing" }));
    expect(mockPush).toHaveBeenCalledWith("/notifications");
    mockResponseListeners[0](response({ id: "ntf_3" }));
    expect(mockPush).toHaveBeenCalledWith("/notifications");
  });

  it("leaves local backup alerts to their own listener", () => {
    startRemotePushRouting();
    mockResponseListeners[0](response({ url: "/(tabs)/backup" }));
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("routeColdStartNotification", () => {
  it("routes the tap that launched the app, once, and clears it", async () => {
    mockLastResponse = response({ id: "ntf_9", link_path: "/shared" });
    await routeColdStartNotification();
    expect(mockPush).toHaveBeenCalledWith("/shares");
    expect(mockClearLast).toHaveBeenCalledTimes(1);
    // The same launch response must not route twice, even before the clear
    // has landed natively.
    mockLastResponse = response({ id: "ntf_9", link_path: "/shared" });
    await routeColdStartNotification();
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the app was opened normally", async () => {
    await routeColdStartNotification();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockClearLast).not.toHaveBeenCalled();
  });
});
