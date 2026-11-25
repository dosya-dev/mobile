import { AppState } from "react-native";
import {
  __resetAnalytics, flushAnalytics, hydrateAnalytics, recordApiActivity, setAnalyticsConsent,
  startAnalyticsLifecycle, track, trackScreen, trackUpload, useAnalyticsConsent,
} from "./analytics";

const mockStore: Record<string, string> = {};
let mockStoreBroken = false;
jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: 1,
  setItemAsync: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => {
    if (mockStoreBroken) throw new Error("User interaction is not allowed");
    return k in mockStore ? mockStore[k] : null;
  }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));
jest.mock("expo-application", () => ({ nativeApplicationVersion: "1.2.0", nativeBuildVersion: "60" }));

type Sent = { url: string; headers: Record<string, string>; body: any };
let sent: Sent[] = [];
let clock = 1_800_000_000_000;

function spyFetch(fail = false) {
  (globalThis as any).fetch = jest.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    if (fail) throw new Error("Network request failed");
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 204 };
  });
}

function names(): string[] {
  return sent.flatMap((s) => s.body.events.map((e: { name: string }) => e.name));
}

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockStoreBroken = false;
  sent = [];
  clock = 1_800_000_000_000;
  (AppState as { currentState: string }).currentState = "active";
  __resetAnalytics(() => clock);
  spyFetch();
});

describe("consent", () => {
  it("is on from the first launch, with no question asked", async () => {
    await hydrateAnalytics();
    expect(useAnalyticsConsent.getState()).toEqual({ consent: "granted", hydrated: true });
    expect(mockStore["dosya.analytics.client"]).toMatch(/^[0-9]{1,12}\.[0-9]{1,12}$/);
    track("share_create");
    await flushAnalytics();
    expect(names()).toEqual(["app_open", "share_create"]);
  });

  it("collects nothing before the stored choice has been read", async () => {
    track("share_create");
    trackScreen(["(tabs)", "settings"]);
    recordApiActivity("POST", "/api/folders");
    trackUpload(5_000_000);
    await flushAnalytics();
    expect(sent).toEqual([]);
  });

  it("collects nothing after a no, and remembers the no", async () => {
    await setAnalyticsConsent(false);
    track("share_create");
    await flushAnalytics();
    expect(sent).toEqual([]);
    expect(mockStore["dosya.analytics.consent"]).toBe("0");
    __resetAnalytics(() => clock);
    await hydrateAnalytics();
    expect(useAnalyticsConsent.getState().consent).toBe("denied");
  });

  it("starts on a yes, with a random install id that is not the device id", async () => {
    await setAnalyticsConsent(true);
    await flushAnalytics();
    expect(mockStore["dosya.analytics.consent"]).toBe("1");
    expect(mockStore["dosya.analytics.client"]).toMatch(/^[0-9]{1,12}\.[0-9]{1,12}$/);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.client_id).toBe(mockStore["dosya.analytics.client"]);
    expect(names()).toEqual(["app_open"]);
  });

  it("keeps the same install id across launches", async () => {
    await setAnalyticsConsent(true);
    const id = mockStore["dosya.analytics.client"];
    __resetAnalytics(() => clock);
    await hydrateAnalytics();
    expect(useAnalyticsConsent.getState().consent).toBe("granted");
    await flushAnalytics();
    expect(sent[0].body.client_id).toBe(id);
  });

  it("drops what was waiting and forgets the id when consent is withdrawn", async () => {
    await setAnalyticsConsent(true);
    track("share_create");
    await setAnalyticsConsent(false);
    await flushAnalytics();
    expect(sent).toEqual([]);
    expect(mockStore["dosya.analytics.client"]).toBeUndefined();
    await setAnalyticsConsent(true);
    expect(mockStore["dosya.analytics.client"]).toBeDefined();
  });

  it("does not take an unreadable store for a first launch", async () => {
    mockStore["dosya.analytics.consent"] = "0";
    mockStoreBroken = true;
    await hydrateAnalytics();
    // Not hydrated: nothing is collected from someone who may have turned it off.
    expect(useAnalyticsConsent.getState()).toEqual({ consent: "unknown", hydrated: false });
    track("share_create");
    await flushAnalytics();
    expect(sent).toEqual([]);
  });
});

describe("what is sent", () => {
  beforeEach(async () => {
    await setAnalyticsConsent(true);
    await flushAnalytics();
    sent = [];
  });

  it("posts a batch to the relay with no credentials and no device id on it", async () => {
    track("share_create");
    clock += 4000;
    await flushAnalytics();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.dosya.dev/api/analytics/collect");
    expect(sent[0].headers).toEqual({ "Content-Type": "application/json" });
    expect(sent[0].body).toMatchObject({
      consent: true, platform: "ios", app_version: "1.2.0", engagement_ms: 4000,
      events: [{ name: "share_create", at: 1_800_000_000_000 }],
    });
    expect(sent[0].body.session_id).toMatch(/^[0-9]+$/);
  });

  it("names actions from succeeded API calls and ignores reads", async () => {
    recordApiActivity("POST", "/api/shares");
    recordApiActivity("DELETE", "/api/files/f_93kd02?permanent=1");
    recordApiActivity("GET", "/api/files");
    recordApiActivity(undefined, "/api/me");
    await flushAnalytics();
    expect(sent[0].body.events.map((e: any) => [e.name, e.params])).toEqual([
      ["share_create", undefined],
      ["file_delete", { batch: false }],
    ]);
  });

  it("does not count an upload's init call: backup makes thousands of them", async () => {
    recordApiActivity("POST", "/api/upload/init");
    await flushAnalytics();
    expect(sent).toEqual([]);
  });

  it("reports a finished upload as a size band", async () => {
    trackUpload(5_000_000);
    await flushAnalytics();
    expect(sent[0].body.events[0]).toMatchObject({ name: "file_upload", params: { size_band: "1_10mb" } });
  });

  it("reports the screen's template once, and only that the Vault was open", async () => {
    trackScreen(["(tabs)", "settings"]);
    trackScreen(["(tabs)", "settings"]);
    trackScreen(["(tabs)", "(files)", "file", "[id]"]);
    trackScreen(["(tabs)", "vault", "space", "[id]", "[folderId]"]);
    trackScreen(["(tabs)", "vault", "file"]);
    await flushAnalytics();
    expect(sent[0].body.events.map((e: any) => e.params.screen)).toEqual(["/settings", "/file/:id", "/vault"]);
  });

  it("cannot send a name: an unknown event or a free-text parameter never leaves", async () => {
    track("opened passport.pdf");
    track("search", { mode: "tax return 2026" });
    track("file_upload", { size_band: "1_10mb", name: "passport.pdf" });
    await flushAnalytics();
    expect(JSON.stringify(sent)).not.toContain("passport");
    expect(JSON.stringify(sent)).not.toContain("tax return");
    expect(names()).toEqual(["search", "file_upload"]);
  });

  it("sends a full batch at once and the rest after", async () => {
    for (let i = 0; i < 30; i++) track("folder_create");
    await flushAnalytics();
    await Promise.resolve();
    expect(sent.map((s) => s.body.events.length)).toEqual([25, 5]);
  });

  it("stays silent offline and does not resend the lost batch", async () => {
    spyFetch(true);
    track("share_create");
    await expect(flushAnalytics()).resolves.toBeUndefined();
    spyFetch();
    await flushAnalytics();
    expect(sent).toEqual([]);
  });
});

describe("visits", () => {
  let emit: (state: string) => void;
  beforeEach(async () => {
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, fn: (s: string) => void) => {
      emit = fn;
      return { remove: jest.fn() };
    }) as never);
    startAnalyticsLifecycle({ locale: () => "tr" });
    await setAnalyticsConsent(true);
    await flushAnalytics();
    sent = [];
  });
  afterEach(() => jest.restoreAllMocks());

  it("sends what is waiting when the app leaves the foreground, with the time in front", async () => {
    track("share_create");
    clock += 9000;
    emit("background");
    await Promise.resolve(); await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ engagement_ms: 9000, locale: "tr" });
  });

  it("keeps the visit across a short absence and starts a new one after a long one", async () => {
    track("share_create");
    await flushAnalytics();
    const first = sent[0].body.session_id;
    emit("background");
    clock += 5 * 60 * 1000;
    emit("active");
    track("share_create");
    await flushAnalytics();
    expect(sent[sent.length - 1].body.session_id).toBe(first);
    emit("background");
    clock += 31 * 60 * 1000;
    emit("active");
    await flushAnalytics();
    const last = sent[sent.length - 1].body;
    expect(last.session_id).not.toBe(first);
    expect(last.events.map((e: any) => e.name)).toEqual(["app_open"]);
  });

  it("does not count a headless launch as a visit", async () => {
    __resetAnalytics(() => clock);
    (AppState as { currentState: string }).currentState = "background";
    await hydrateAnalytics();
    await flushAnalytics();
    expect(sent).toEqual([]);
  });
});
