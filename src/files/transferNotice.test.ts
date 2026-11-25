const state = { platform: "android" as "android" | "ios", granted: true, appState: "background" };

jest.mock("react-native", () => ({
  Platform: { get OS() { return state.platform; } },
  AppState: { get currentState() { return state.appState; } },
}));

// The module only needs the language runtime for the channel name; the real one
// pulls the keychain in, which this file's react-native mock cannot host.
jest.mock("@/lib/i18n", () => ({
  t: (key: string) => key,
  onLocaleChange: () => () => {},
}));

const scheduled: { title: string; body: string; id: string | undefined; sticky: unknown }[] = [];
const dismissed: string[] = [];

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: state.granted, canAskAgain: false })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: state.granted })),
  setNotificationChannelAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async (req: { identifier?: string; content: Record<string, unknown> }) => {
    scheduled.push({
      title: req.content.title as string,
      body: req.content.body as string,
      id: req.identifier,
      sticky: req.content.sticky,
    });
    return req.identifier ?? "n1";
  }),
  dismissNotificationAsync: jest.fn(async (id: string) => { dismissed.push(id); }),
  AndroidImportance: { LOW: 2, DEFAULT: 3 },
}));

import {
  TRANSFER_CHANNEL,
  clearTransferNotification,
  notifyTransferDone,
  updateTransferNotification,
} from "./transferNotice";

beforeEach(() => {
  scheduled.length = 0;
  dismissed.length = 0;
  state.platform = "android";
  state.granted = true;
  state.appState = "background";
});

describe("the ongoing progress notification", () => {
  it("names the file and how far along it is", async () => {
    await updateTransferNotification("f1", "match.mp4", 42, "9.4 MB/s · 38s left");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].title).toBe("match.mp4");
    expect(scheduled[0].body).toContain("42%");
    expect(scheduled[0].body).toContain("38s left");
  });

  it("replaces its own notification rather than stacking one per tick", async () => {
    await updateTransferNotification("f1", "match.mp4", 10, "");
    await updateTransferNotification("f1", "match.mp4", 20, "");
    expect(scheduled[0].id).toBe(scheduled[1].id);
  });

  // iOS has no updatable progress in a local notification, so an ongoing one
  // would be a stack of identical banners the user has to dismiss by hand.
  it("posts nothing at all on iOS", async () => {
    state.platform = "ios";
    await updateTransferNotification("f1", "match.mp4", 42, "");
    expect(scheduled).toHaveLength(0);
  });

  it("stays silent when notifications were never granted", async () => {
    state.granted = false;
    await updateTransferNotification("f1", "match.mp4", 42, "");
    expect(scheduled).toHaveLength(0);
  });

  it("takes the notification down when the transfer ends", async () => {
    await updateTransferNotification("f1", "match.mp4", 42, "");
    await clearTransferNotification("f1");
    expect(dismissed).toHaveLength(1);
  });
});

describe("the completion notification", () => {
  it("says where the file went, on both platforms", async () => {
    await notifyTransferDone("match.mp4", "Saved to Photos");
    state.platform = "ios";
    await notifyTransferDone("clip.mp4", "Saved to Files");
    expect(scheduled.map((s) => s.title)).toEqual(["match.mp4", "clip.mp4"]);
    expect(scheduled[0].body).toBe("Saved to Photos");
  });

  // The viewer already showed a ring going green and a toast. A banner over
  // the top of that is noise.
  it("stays quiet while the user is watching the app do it", async () => {
    state.appState = "active";
    await notifyTransferDone("match.mp4", "Saved to Photos");
    expect(scheduled).toHaveLength(0);
  });
});

it("keeps transfers on their own channel, so muting backup does not mute them", () => {
  expect(TRANSFER_CHANNEL).toBe("transfers");
});
