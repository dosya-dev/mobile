import { act, render, screen, waitFor } from "@testing-library/react-native";
import RootLayout, { Providers } from "./_layout";
import { Text } from "react-native";
import { useAuthStore } from "@/auth/authStore";
import { useMaintenanceStore } from "@/ui/maintenanceStore";
import { useReaderPrefs } from "@/reader/readerPrefs";
import { purgeAccountData } from "@/auth/purge";
import { shouldPurgeOnSignOut } from "@/auth/sessionDrop";
import { hasSeenWelcome } from "@/onboarding/onboardingState";

// Offline files (src/offline) are tested on their own; the root only starts
// them for the signed-in account and stops them on the way out.
const mockStopOffline = jest.fn();
jest.mock("@/offline/background", () => ({ startOfflineForAccount: jest.fn(() => mockStopOffline) }));

jest.mock("@/backup/background", () => ({
  registerBackupTask: jest.fn(async () => {}),
  // Real implementation subscribes to media-library + AppState changes and
  // returns a disposer; unmocked, calling it throws ("not a function"),
  // which the root ErrorBoundary catches and uses to replace the whole
  // signed-in tree - silently discarding component state (e.g. the ref this
  // file's "purge on sign-out" tests depend on surviving a signedIn render).
  startAutoBackupTriggers: jest.fn(() => () => {}),
  settleBackgroundUploads: jest.fn(async () => {}),
}));

// Personas background scheduling (src/personas/device/schedule.ts) is tested
// on its own; here only that the root mounts and unmounts its watch.
const mockOffPersonasSchedule = jest.fn();
jest.mock("@/personas/device/schedule", () => ({ watchPersonasSchedule: jest.fn(() => mockOffPersonasSchedule) }));

// The gates each withhold their children behind an async check; the Stack's
// screen ORDER is what the test below is about, so pass them through.
jest.mock("@/auth/AppLockGate", () => ({ AppLockGate: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/onboarding/OnboardingGate", () => ({ OnboardingGate: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/files/WorkspaceGate", () => ({ WorkspaceGate: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/profile/hooks", () => ({ useAppearanceSync: () => {} }));
jest.mock("@/upload/runner", () => ({ sweepUploadCache: jest.fn(async () => {}) }));
// The persisted manual upload queue. Restored BEFORE the cache sweep, so the
// sweep knows which staged copies to leave alone.
jest.mock("@/upload/persist", () => ({
  hydrateUploadQueue: jest.fn(async () => new Set(["file:///cache/upload-share-up_1.pdf"])),
  resumeUploadQueue: jest.fn(),
  startUploadQueuePersistence: jest.fn(),
}));
jest.mock("@/upload/uploadBlock", () => ({ hydrateUploadBlock: jest.fn(async () => {}) }));
jest.mock("@/backup/statusBridge", () => ({ startStatusBridge: jest.fn() }));
// Offline cold start: the query cache is restored from disk at launch and
// written back whenever the app leaves the foreground.
jest.mock("@/lib/queryPersist", () => ({
  restoreQueryCache: jest.fn(async () => true),
  startQueryPersistence: jest.fn(() => jest.fn()),
}));
// Launch-time sweep of the transient (locked / view-only) download area.
jest.mock("@/files/cacheControl", () => ({ sweepSessionCaches: jest.fn(async () => {}) }));
jest.mock("@/backup/alerts", () => ({ startBackupAlerts: jest.fn() }));
jest.mock("@/auth/purge", () => ({ purgeAccountData: jest.fn(async () => {}), pendingOfflinePurge: jest.fn(() => null) }));
jest.mock("@/filesProvider/link", () => ({ linkFilesProvider: jest.fn(async () => {}) }));
// The RULE (which drop reasons justify destroying account data) is covered in
// src/auth/sessionDrop.test.ts. Mocked here so these tests can drive each
// branch directly and stay about the WIRING - and so they don't depend on the
// real authStore's module-level drop state, which no test can reset.
jest.mock("@/auth/sessionDrop", () => ({ shouldPurgeOnSignOut: jest.fn(() => true) }));

// Default resolves "seen" so existing signed-out tests - which don't care
// which signed-out destination is picked - keep landing on the pre-Task-13
// behavior (login) unless a test overrides this to exercise the deck itself.
jest.mock("@/onboarding/onboardingState", () => ({ hasSeenWelcome: jest.fn(async () => true) }));

// readerPrefs.hydrate() reads from SecureStore on the startup effect below;
// give it an inert mock so that path resolves deterministically under test.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
}));

// Captures what the root layout declares on its <Stack>, in order. The order is
// load-bearing (see the "root stack default route" test below), so the mock has
// to preserve it rather than swallow children.
const stackChildren: { name: string }[] = [];
// A single shared replace/push pair (rather than a fresh jest.fn() per
// useRouter() call) so tests can assert on what the AuthGate redirect effect
// actually called. `mock`-prefixed because babel-plugin-jest-hoist only
// auto-hoists `const` bindings whose initializer is provably side-effect-free
// (stackChildren's `[]` qualifies; `jest.fn()` is a call, so it does not).
const mockReplace = jest.fn();
const mockPush = jest.fn();
// Mutable so a test can drive the redirect effect's `segments` branch (e.g.
// the vault-diagnostics exemption below); reset after every test so a
// left-over value never leaks into an unrelated describe block.
let mockSegments: string[] = [];
jest.mock("expo-router", () => {
  const StackMock = ({ children }: { children?: React.ReactNode }) => {
    stackChildren.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Children, isValidElement } = require("react");
    Children.forEach(children, (child: unknown) => {
      if (!isValidElement(child)) return;
      const { name } = (child as { props: { name?: string } }).props;
      if (name) stackChildren.push({ name });
    });
    return null;
  };
  StackMock.Screen = function Screen() { return null; };
  return {
    Stack: StackMock,
    useRouter: () => ({ replace: mockReplace, push: mockPush }),
    useSegments: () => mockSegments,
    // Read by useShareIntentRouting to tell "signed in" apart from "a navigator
    // actually exists". A mounted key here keeps these cases exercising the auth
    // gate rather than the share-intent path; the gating itself is covered in
    // src/share-intent/useShareIntentRouting.test.tsx.
    useRootNavigationState: () => ({ key: "root" }),
    // Handed to Sentry's navigation integration for screen breadcrumbs. A
    // stable object so the registration effect runs once per mount.
    useNavigationContainerRef: () => mockNavigationRef,
  };
});
const mockNavigationRef = { current: null, isReady: () => true };

// The real @expo-google-fonts/* packages resolve `useFonts` asynchronously
// (a post-mount state update), which would leave `fontsLoaded` false during
// these synchronous renders and trigger act() warnings. Mock them to report
// "already loaded" so the auth-gate tests below exercise the auth status
// branch, not the font-loading branch.
jest.mock("@expo-google-fonts/space-grotesk", () => ({
  useFonts: () => [true],
  SpaceGrotesk_400Regular: "SpaceGrotesk_400Regular",
  SpaceGrotesk_500Medium: "SpaceGrotesk_500Medium",
  SpaceGrotesk_700Bold: "SpaceGrotesk_700Bold",
}));
jest.mock("@expo-google-fonts/space-mono", () => ({
  SpaceMono_400Regular: "SpaceMono_400Regular",
}));

// Plain alias for readability in assertions below - same jest.fn() instance
// as the one wired into the expo-router mock above.
const replace = mockReplace;

// The real boot (keychain read, then language load) is covered in
// _layout.i18n.test.tsx. Here it answers English in the same tick, as a thenable,
// so the layout's setState lands inside the render's own act() and the auth-gate
// cases below stay about auth.
jest.mock("@/lib/i18n", () => {
  const actual = jest.requireActual("@/lib/i18n");
  const english = jest.requireActual("@/i18n/messages/en.json");
  return {
    ...actual,
    bootI18n: () => ({
      then: (cb: (b: unknown) => void) => cb({ locale: "en", preference: "device", messages: english }),
    }),
  };
});

// Segments default to [] for every test unless one overrides mockSegments
// directly; reset unconditionally so a later describe block never inherits it.
afterEach(() => { mockSegments = []; });

function renderSignedOut(
  overrides: Partial<{ pending2fa: { method: "totp" | "email"; challengeToken: string } | null }> = {},
) {
  useAuthStore.setState({
    status: "signedOut",
    user: null,
    hydrate: jest.fn(),
    pending2fa: null,
    pendingVerificationEmail: null,
    ...overrides,
  } as never);
  return render(<RootLayout />);
}

describe("launch: persisted upload queue", () => {
  it("restores the queue, then sweeps the upload cache around what it still needs", async () => {
    const { hydrateUploadQueue, startUploadQueuePersistence } = jest.requireMock("@/upload/persist");
    const { sweepUploadCache } = jest.requireMock("@/upload/runner");
    renderSignedOut();
    await waitFor(() => expect(sweepUploadCache).toHaveBeenCalledWith(new Set(["file:///cache/upload-share-up_1.pdf"])));
    expect(hydrateUploadQueue).toHaveBeenCalledTimes(1);
    expect(startUploadQueuePersistence).toHaveBeenCalled();
  });

  it("does not send anything while signed out - a restored queue waits for a session", async () => {
    const persist = jest.requireMock("@/upload/persist");
    renderSignedOut();
    await waitFor(() => expect(persist.hydrateUploadQueue).toHaveBeenCalled());
    expect(persist.resumeUploadQueue).not.toHaveBeenCalled();
  });

  it("resumes the queue once a session is in place", async () => {
    const persist = jest.requireMock("@/upload/persist");
    useAuthStore.setState({ status: "signedIn", user: { id: "u1" }, hydrate: jest.fn(), pending2fa: null } as never);
    render(<RootLayout />);
    await waitFor(() => expect(persist.resumeUploadQueue).toHaveBeenCalled());
  });
});

describe("launch: Personas background schedule", () => {
  it("watches the schedule from launch, signed in or not, and lets it go on unmount", async () => {
    const { watchPersonasSchedule } = jest.requireMock("@/personas/device/schedule");
    watchPersonasSchedule.mockClear();
    mockOffPersonasSchedule.mockClear();
    const view = renderSignedOut();
    await waitFor(() => expect(watchPersonasSchedule).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(mockOffPersonasSchedule).toHaveBeenCalledTimes(1);
  });
});

describe("launch: offline cold start", () => {
  it("restores the persisted query cache, keeps persisting it, and sweeps session caches", async () => {
    const { restoreQueryCache, startQueryPersistence } = jest.requireMock("@/lib/queryPersist");
    const { sweepSessionCaches } = jest.requireMock("@/files/cacheControl");
    renderSignedOut();
    await waitFor(() => expect(restoreQueryCache).toHaveBeenCalled());
    expect(startQueryPersistence).toHaveBeenCalled();
    expect(sweepSessionCaches).toHaveBeenCalled();
  });

  it("settles the background uploads iOS finished while the app was not running", async () => {
    // iOS relaunches the app to hand these results over; nothing else in the
    // process asks for them, so a start that skips this leaves finished
    // uploads unregistered and their staged copies on disk. It waits for the
    // session, though: registering them is an API call.
    const { settleBackgroundUploads } = jest.requireMock("@/backup/background");
    useAuthStore.setState({ status: "signedIn", user: { id: "u1" }, hydrate: jest.fn(), pending2fa: null } as never);
    render(<RootLayout />);
    await waitFor(() => expect(settleBackgroundUploads).toHaveBeenCalled());
  });

  it("does not settle in a signed-out process", async () => {
    const { settleBackgroundUploads } = jest.requireMock("@/backup/background");
    (settleBackgroundUploads as jest.Mock).mockClear();
    renderSignedOut();
    await waitFor(() => expect(jest.requireMock("@/lib/queryPersist").restoreQueryCache).toHaveBeenCalled());
    expect(settleBackgroundUploads).not.toHaveBeenCalled();
  });
});

describe("Providers", () => {
  it("renders children inside the provider tree", () => {
    const { getByText } = render(
      <Providers>
        <Text>child</Text>
      </Providers>,
    );
    expect(getByText("child")).toBeTruthy();
  });
});

describe("RootLayout auth gate", () => {
  it("shows a loading indicator while auth status is loading", () => {
    useAuthStore.setState({ status: "loading", hydrate: jest.fn(), pending2fa: null } as never);
    render(<RootLayout />);
    expect(screen.getByTestId("app-loading")).toBeTruthy();
  });
});

describe("maintenance mode", () => {
  // The mobile platform switch being off takes over the whole app - signed
  // in or out - rather than living inside either branch (see app/_layout.tsx).
  afterEach(() => useMaintenanceStore.setState({ maintenance: null }));

  // The language boots first (async), so the first frame is the loading screen.
  it("shows the maintenance screen instead of the signed-out stack", async () => {
    useMaintenanceStore.setState({ maintenance: { surface: "mobile", message: null } });
    renderSignedOut();
    expect(await screen.findByTestId("maintenance-screen")).toBeTruthy();
  });

  it("shows the maintenance screen instead of the signed-in tree", async () => {
    useMaintenanceStore.setState({ maintenance: { surface: "mobile", message: "brb" } });
    useAuthStore.setState({
      status: "signedIn",
      user: { id: "u1", email: "a@b.com", name: "A", created_at: 1 },
      hydrate: jest.fn(),
      pending2fa: null,
    } as never);
    render(<RootLayout />);
    expect(await screen.findByTestId("maintenance-screen")).toBeTruthy();
  });
});

describe("root stack default route", () => {
  // Regression: signing in landed the user on the full-screen player ("Nothing
  // playing.") with nothing beneath it - system back quit the app, proving
  // `player` was the stack's ROOT, not a modal pushed over the tabs.
  //
  // Why: React Navigation's StackRouter falls back to `routeNames[0]` whenever it
  // has to build initial state, and expo-router orders explicitly declared
  // screens FIRST (getSortedChildren in expo-router/build/useScreens.js). `player`
  // was the only declared screen, so it was routeNames[0] and became the default.
  // Declaring (tabs) ahead of it makes the fallback the Files tab instead.
  it("declares (tabs) before any other screen so it is the fallback route", () => {
    useAuthStore.setState({ status: "signedIn", hydrate: jest.fn(), pending2fa: null } as never);
    render(<RootLayout />);
    expect(stackChildren.length).toBeGreaterThan(0);
    expect(stackChildren[0].name).toBe("(tabs)");
    expect(stackChildren.map((c) => c.name)).toContain("player");
  });
});

describe("RootLayout startup hydration", () => {
  it("hydrates reader prefs (font size / theme) on mount, alongside auth", () => {
    useReaderPrefs.setState({ fontSizePct: 100, themeId: "light", hydrated: false });
    useAuthStore.setState({ status: "loading", hydrate: jest.fn(), pending2fa: null } as never);
    render(<RootLayout />);
    return waitFor(() => expect(useReaderPrefs.getState().hydrated).toBe(true));
  });
});

describe("purge on sign-out", () => {
  // The whole point of capturing the id in a ref (see app/_layout.tsx) is that
  // useAuthStore's `user` is already null by the time `status` flips to
  // "signedOut" - so these pin the id purgeAccountData is actually called
  // with, not just that it's called at all.
  beforeEach(() => {
    (purgeAccountData as jest.Mock).mockClear();
    (shouldPurgeOnSignOut as jest.Mock).mockReturnValue(true);
  });

  /**
   * The expensive half of the "logged out overnight" report. Reaching
   * signedOut does not prove the account is gone - hydrate() also lands there
   * when it could not read the token store at all, leaving a live session on
   * disk. Purging on that transition regardless is what cost users their
   * backup ledger, so the shell must ask before it destroys anything.
   */
  it("does not purge when the sign-out reason is indeterminate", async () => {
    (shouldPurgeOnSignOut as jest.Mock).mockReturnValue(false);
    useAuthStore.setState({
      status: "signedIn",
      user: { id: "acct-42", email: "a@b.com", name: "A", created_at: 1 },
      hydrate: jest.fn(),
      pending2fa: null,
    } as never);
    render(<RootLayout />);

    useAuthStore.setState({ status: "signedOut", user: null } as never);

    await waitFor(() => expect(shouldPurgeOnSignOut).toHaveBeenCalled());
    expect(purgeAccountData).not.toHaveBeenCalled();
  });

  it("purges with the last signed-in account's id, not null", async () => {
    useAuthStore.setState({
      status: "signedIn",
      user: { id: "acct-42", email: "a@b.com", name: "A", created_at: 1 },
      hydrate: jest.fn(),
      pending2fa: null,
    } as never);
    render(<RootLayout />);

    useAuthStore.setState({ status: "signedOut", user: null } as never);

    await waitFor(() => expect(purgeAccountData).toHaveBeenCalledWith("acct-42"));
    expect(purgeAccountData).not.toHaveBeenCalledWith(null);
  });

  it("purges with null when sign-out happens with no prior signed-in render", async () => {
    // Mirrors a fresh launch where hydrate() resolves straight to signedOut -
    // the account id was never captured because the user was never signed in
    // during this render tree's lifetime.
    useAuthStore.setState({ status: "loading", user: null, hydrate: jest.fn(), pending2fa: null } as never);
    render(<RootLayout />);

    useAuthStore.setState({ status: "signedOut", user: null } as never);

    await waitFor(() => expect(purgeAccountData).toHaveBeenCalledWith(null));
  });
});

describe("crash reporting", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require("@sentry/react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { navigationIntegration } = require("@/telemetry/sentry");

  beforeEach(() => {
    (Sentry.setUser as jest.Mock).mockClear();
    (navigationIntegration.registerNavigationContainer as jest.Mock).mockClear();
  });

  it("initialises the SDK when the layout module loads and wraps the root", () => {
    // Both happened at import time, before any render: the global error
    // handler has to be in place ahead of the first thing that can throw.
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: expect.stringContaining("sentry.io") }));
    expect(Sentry.wrap).toHaveBeenCalledTimes(1);
  });

  it("files crashes under the opaque account id, and clears it on sign-out", async () => {
    useAuthStore.setState({
      status: "signedIn",
      user: { id: "acct-42", email: "a@b.com", name: "A", created_at: 1 },
      hydrate: jest.fn(),
      pending2fa: null,
    } as never);
    render(<RootLayout />);
    await waitFor(() => expect(Sentry.setUser).toHaveBeenCalledWith({ id: "acct-42" }));
    // Never the email: the user object carries it, the report must not.
    for (const [arg] of (Sentry.setUser as jest.Mock).mock.calls) {
      expect(JSON.stringify(arg ?? null)).not.toContain("a@b.com");
    }

    act(() => {
      useAuthStore.setState({ status: "signedOut", user: null } as never);
    });
    await waitFor(() => expect(Sentry.setUser).toHaveBeenLastCalledWith(null));
  });

  it("registers expo-router's navigation container for screen breadcrumbs", () => {
    renderSignedOut();
    expect(navigationIntegration.registerNavigationContainer).toHaveBeenCalledWith(mockNavigationRef);
  });
});

describe("welcome deck routing", () => {
  // Placed last: each test here sets its own hasSeenWelcome() resolution via
  // mockResolvedValue (which persists until changed again), so leaving this
  // block last means no earlier describe block's assumptions about the
  // signed-out destination are affected by what runs here.
  beforeEach(() => {
    mockReplace.mockClear();
    mockPush.mockClear();
  });

  it("sends a first-time signed-out device to the welcome deck", async () => {
    (hasSeenWelcome as jest.Mock).mockResolvedValue(false);
    renderSignedOut();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/(auth)/welcome"));
  });

  it("sends a returning signed-out device to login", async () => {
    (hasSeenWelcome as jest.Mock).mockResolvedValue(true);
    renderSignedOut();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/(auth)/login"));
  });

  it("never interrupts a half-finished sign-in with the deck", async () => {
    (hasSeenWelcome as jest.Mock).mockResolvedValue(false);
    renderSignedOut({ pending2fa: { method: "totp", challengeToken: "t" } });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/(auth)/2fa"));
  });

  // The redirect effect CONSUMES welcomeSeen on every status change, but the
  // read had `[]` deps - resolved once per process. A device that saw the deck,
  // signed up, and then signed out in the same session was sent back to the
  // value deck instead of to login.
  it("re-reads the welcome flag on sign-out instead of reusing the launch-time answer", async () => {
    (hasSeenWelcome as jest.Mock).mockResolvedValue(false);
    useAuthStore.setState({
      status: "signedOut", user: null, hydrate: jest.fn(), pending2fa: null, pendingVerificationEmail: null,
    } as never);
    render(<RootLayout />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/(auth)/welcome"));

    // The deck was dismissed and the device flag written; the user signed up,
    // used the app, and is now signing out.
    (hasSeenWelcome as jest.Mock).mockResolvedValue(true);
    act(() => {
      useAuthStore.setState({
        status: "signedIn", user: { id: "u1", email: "a@b.com", name: "A", created_at: 1 },
      } as never);
    });
    replace.mockClear();
    act(() => { useAuthStore.setState({ status: "signedOut", user: null } as never); });

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/(auth)/login"));
    expect(replace).not.toHaveBeenCalledWith("/(auth)/welcome");
  });

  it("still redirects a signed-out user somewhere reachable even if the welcome check itself rejects", async () => {
    // Defense in depth at the call site: hasSeenWelcome itself now resolves
    // rather than rejects (see onboardingState.test.ts), but this mock
    // bypasses that entirely, so it proves AuthGate's own .catch guard - not
    // hasSeenWelcome's internal one - is what stands between a rejection and
    // welcomeSeen staying null forever (which the redirect effect treats as
    // "still resolving" and never redirects for).
    (hasSeenWelcome as jest.Mock).mockRejectedValue(new Error("keychain unavailable"));
    renderSignedOut();
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  // The Vault diagnostics screen needs no account, no network and no user
  // data (see app/vault-diagnostics.tsx); it must stay reachable by deep link
  // on a device that has never signed in, not get bounced to the deck/login.
  it("lets a signed-out device open the Vault diagnostics screen", async () => {
    (hasSeenWelcome as jest.Mock).mockResolvedValue(false);
    mockSegments = ["vault-diagnostics"];
    renderSignedOut();
    // Sibling assertion proving the launch effect (and so the redirect effect
    // alongside it) actually ran, since there is no positive "stayed put"
    // navigation call to wait on directly.
    await waitFor(() => expect(jest.requireMock("@/lib/queryPersist").restoreQueryCache).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });

  it("lets a signed-out device open the Personas parity screen", async () => {
    (hasSeenWelcome as jest.Mock).mockResolvedValue(false);
    mockSegments = ["personas-parity"];
    renderSignedOut();
    // Sibling assertion proving the launch effect (and so the redirect effect
    // alongside it) actually ran, since there is no positive "stayed put"
    // navigation call to wait on directly.
    await waitFor(() => expect(jest.requireMock("@/lib/queryPersist").restoreQueryCache).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("iOS Files extension link", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { linkFilesProvider } = require("@/filesProvider/link") as { linkFilesProvider: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppState } = require("react-native") as { AppState: { addEventListener: jest.Mock } };
  const appStateSub = { remove: jest.fn() };

  beforeEach(() => {
    linkFilesProvider.mockClear();
    // Only listeners registered by THIS test: earlier renders in this file left
    // their (already removed) handlers in the spy's call log.
    jest.spyOn(AppState, "addEventListener").mockClear().mockReturnValue(appStateSub as never);
  });

  function renderSignedInAs(id: string) {
    useAuthStore.setState({
      status: "signedIn",
      user: { id, email: "a@b.com", name: "A", created_at: 1 },
      hydrate: jest.fn(),
      pending2fa: null,
    } as never);
    return render(<RootLayout />);
  }

  it("links once for the signed-in account on mount", async () => {
    renderSignedInAs("acct-1");
    await waitFor(() => expect(linkFilesProvider).toHaveBeenCalledWith("acct-1"));
    expect(linkFilesProvider).toHaveBeenCalledTimes(1);
  });

  it("links again when the app returns to the foreground", async () => {
    // The extension wipes its own keychain entry after the server rejects its
    // refresh, and tells the user to open the app. A foreground is that moment;
    // the mount-only effect never saw it.
    renderSignedInAs("acct-1");
    await waitFor(() => expect(linkFilesProvider).toHaveBeenCalledTimes(1));
    const calls = (AppState.addEventListener as jest.Mock).mock.calls.filter((c) => c[0] === "change");
    expect(calls.length).toBeGreaterThan(0);
    // The language provider listens for the foreground too; fire every listener.
    act(() => calls.forEach((c) => (c[1] as (s: string) => void)("active")));
    await waitFor(() => expect(linkFilesProvider).toHaveBeenCalledTimes(2));
    expect(linkFilesProvider).toHaveBeenLastCalledWith("acct-1");
  });

  it("does not link on foreground while signed out", async () => {
    renderSignedOut();
    const calls = (AppState.addEventListener as jest.Mock).mock.calls.filter((c) => c[0] === "change");
    for (const c of calls) act(() => (c[1] as (s: string) => void)("active"));
    await Promise.resolve();
    expect(linkFilesProvider).not.toHaveBeenCalled();
  });
});

describe("offline files", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startOfflineForAccount } = require("@/offline/background") as { startOfflineForAccount: jest.Mock };

  beforeEach(() => {
    startOfflineForAccount.mockClear();
    mockStopOffline.mockClear();
  });

  it("starts for the signed-in account and stops on sign-out", async () => {
    useAuthStore.setState({
      status: "signedIn",
      user: { id: "acct-1", email: "a@b.com", name: "A", created_at: 1 },
      hydrate: jest.fn(),
      pending2fa: null,
    } as never);
    render(<RootLayout />);
    await waitFor(() => expect(startOfflineForAccount).toHaveBeenCalledWith("acct-1"));
    expect(startOfflineForAccount).toHaveBeenCalledTimes(1);
    act(() => { useAuthStore.setState({ status: "signedOut", user: null } as never); });
    await waitFor(() => expect(mockStopOffline).toHaveBeenCalled());
  });

  it("does not start signed out", async () => {
    renderSignedOut();
    await Promise.resolve();
    expect(startOfflineForAccount).not.toHaveBeenCalled();
  });

  it("an account switch waits for the previous account's offline purge before starting the next", async () => {
    // Otherwise the previous account's endSession, running a few awaits into
    // its purge, would end the session the next account had just begun.
    const { pendingOfflinePurge } = jest.requireMock("@/auth/purge") as { pendingOfflinePurge: jest.Mock };
    let finish!: () => void;
    pendingOfflinePurge.mockReturnValueOnce(new Promise<void>((r) => { finish = r; }));
    useAuthStore.setState({
      status: "signedIn",
      user: { id: "acct-2", email: "b@b.com", name: "B", created_at: 1 },
      hydrate: jest.fn(),
      pending2fa: null,
    } as never);
    render(<RootLayout />);
    await act(async () => { await Promise.resolve(); });
    expect(startOfflineForAccount).not.toHaveBeenCalled();
    await act(async () => { finish(); await Promise.resolve(); });
    await waitFor(() => expect(startOfflineForAccount).toHaveBeenCalledWith("acct-2"));
    expect(startOfflineForAccount).toHaveBeenCalledTimes(1);
  });
});
