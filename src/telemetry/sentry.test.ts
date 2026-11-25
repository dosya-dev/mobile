import * as Sentry from "@sentry/react-native";
import {
  DEFAULT_SENTRY_DSN,
  buildSentryOptions,
  initSentry,
  isSentryEnabled,
  navigationIntegration,
  reportError,
  resolveDsn,
  scrubBreadcrumb,
  scrubEvent,
  setSentryUser,
} from "./sentry";

describe("resolveDsn", () => {
  it("falls back to the checked-in project DSN", () => {
    expect(resolveDsn({})).toBe(DEFAULT_SENTRY_DSN);
  });

  it("prefers an explicit override", () => {
    expect(resolveDsn({ EXPO_PUBLIC_SENTRY_DSN: " https://k@o1.ingest.sentry.io/2 " })).toBe(
      "https://k@o1.ingest.sentry.io/2",
    );
  });

  it("treats an empty override as 'reporting off'", () => {
    expect(resolveDsn({ EXPO_PUBLIC_SENTRY_DSN: "" })).toBeNull();
    expect(resolveDsn({ EXPO_PUBLIC_SENTRY_DSN: "   " })).toBeNull();
  });
});

describe("isSentryEnabled", () => {
  it("is on for release builds", () => {
    expect(isSentryEnabled({}, false)).toBe(true);
  });

  it("is off for dev builds unless EXPO_PUBLIC_SENTRY_DEV=1", () => {
    expect(isSentryEnabled({}, true)).toBe(false);
    expect(isSentryEnabled({ EXPO_PUBLIC_SENTRY_DEV: "true" }, true)).toBe(false);
    expect(isSentryEnabled({ EXPO_PUBLIC_SENTRY_DEV: "1" }, true)).toBe(true);
  });

  it("is off whenever the DSN is blanked, even in release", () => {
    expect(isSentryEnabled({ EXPO_PUBLIC_SENTRY_DSN: "" }, false)).toBe(false);
  });
});

describe("scrubEvent", () => {
  it("keeps the opaque user id and drops everything else about the user", () => {
    const event = scrubEvent({
      user: { id: "usr_1", email: "a@b.c", username: "a", ip_address: "1.2.3.4" },
    });
    expect(event.user).toEqual({ id: "usr_1" });
  });

  it("clears a user block that has no id", () => {
    expect(scrubEvent({ user: { email: "a@b.c" } }).user).toBeUndefined();
  });

  it("leaves an event without a user alone", () => {
    const event = { message: "hi", user: undefined };
    expect(scrubEvent(event)).toBe(event);
    expect(event.user).toBeUndefined();
  });
});

describe("buildSentryOptions", () => {
  it("names the environment after the build type and never sends default PII", () => {
    const release = buildSentryOptions({}, false);
    expect(release).toMatchObject({
      dsn: DEFAULT_SENTRY_DSN,
      enabled: true,
      environment: "production",
      sendDefaultPii: false,
      beforeSend: scrubEvent,
    });
    expect(release.integrations).toContain(navigationIntegration);
    expect(buildSentryOptions({}, true)).toMatchObject({ enabled: false, environment: "development" });
  });
});

describe("SDK wiring", () => {
  beforeEach(() => jest.clearAllMocks());

  it("initialises the SDK once, however many times the layout module evaluates", () => {
    initSentry();
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: DEFAULT_SENTRY_DSN }));
  });

  it("records only the account id, and clears it on sign-out", () => {
    setSentryUser("usr_9");
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: "usr_9" });
    setSentryUser(null);
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
  });

  it("forwards caught errors with their context", () => {
    const err = new Error("boom");
    reportError(err, { componentStack: "in Foo" });
    expect(Sentry.captureException).toHaveBeenCalledWith(err, { extra: { componentStack: "in Foo" } });
    reportError(err);
    expect(Sentry.captureException).toHaveBeenLastCalledWith(err, undefined);
  });
});

describe("scrubBreadcrumb", () => {
  it("drops the request breadcrumbs of the Vault's unlock ceremony (spec 8.1)", () => {
    // No key material is in them, but "this account ran the unlock ceremony at
    // time T" is not ours to collect either.
    expect(scrubBreadcrumb({ category: "fetch", data: { url: "https://api.dosya.dev/api/e2ee/oprf-evaluate", method: "POST" } })).toBeNull();
    expect(scrubBreadcrumb({ category: "xhr", data: { url: "https://api.dosya.dev/api/e2ee/user-keys?x=1" } })).toBeNull();
  });

  it("keeps every other breadcrumb, requests included", () => {
    const request = { category: "fetch", data: { url: "https://api.dosya.dev/api/files" } };
    expect(scrubBreadcrumb(request)).toBe(request);
    const navigation = { category: "navigation", data: { url: "/vault" } };
    expect(scrubBreadcrumb(navigation)).toBe(navigation);
    const bare = { category: "fetch" };
    expect(scrubBreadcrumb(bare)).toBe(bare);
  });

  it("is the hook the SDK is initialised with", () => {
    expect(buildSentryOptions({}, false).beforeBreadcrumb).toBe(scrubBreadcrumb);
  });
});
