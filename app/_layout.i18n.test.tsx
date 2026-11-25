import { act, render, screen, waitFor } from "@testing-library/react-native";
import RootLayout from "./_layout";
import { Alert, AppState, I18nManager, Text } from "react-native";
import { reloadAppAsync } from "expo";
import ar from "@/i18n/messages/ar.json";
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

import { __resetI18nForTests, t as translate } from "@/lib/i18n";

// Header titles are recorded as the layout declares them, so the test can tell
// "Turkish from the first frame" from "English first, Turkish a moment later".
const mockTitles: string[] = [];
jest.mock("expo-router", () => {
  const mock = require("../test-utils/i18n-sweep").routerMockWithTitles();
  const Screen = mock.Stack.Screen;
  mock.Stack.Screen = (props: { options?: { title?: string } }) => {
    if (props.options?.title) mockTitles.push(props.options.title);
    return Screen(props);
  };
  return mock;
});

const mockGetItem = jest.fn();
jest.mock("@/lib/keychain", () => ({
  getItem: (...a: unknown[]) => mockGetItem(...a),
  setItem: jest.fn(async () => {}),
}));
let mockDeviceTags = ["tr-TR"];
jest.mock("expo-localization", () => ({ getLocales: () => mockDeviceTags.map((languageTag) => ({ languageTag })) }));

beforeEach(() => {
  __resetI18nForTests();
  mockDeviceTags = ["tr-TR"];
  mockTitles.length = 0;
  mockGetItem.mockReset();
  useAuthStore.setState({ status: "signedIn", user: { id: "u1" }, hydrate: jest.fn(), pending2fa: null, pendingVerificationEmail: null } as never);
});

describe("root layout language boot", () => {
  it("keeps the loading screen until the language is ready, then paints Turkish with no English frame", async () => {
    let release!: (v: string | null) => void;
    mockGetItem.mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<RootLayout />);

    // Auth is signed in and fonts are loaded, so only the language holds the gate.
    expect(screen.getByTestId("app-loading")).toBeTruthy();
    expect(screen.queryByTestId("screen-title")).toBeNull();
    expect(mockTitles).toEqual([]);

    await act(async () => release("device"));
    await waitFor(() => expect(screen.queryByTestId("app-loading")).toBeNull());

    expect(screen.getAllByTestId("screen-title").map((n) => n.props.children)).toContain("Dil");
    expect(mockTitles).toContain("Dil");
    expect(mockTitles).not.toContain("Language");
  });

  it("starts in the stored language over the device language", async () => {
    mockGetItem.mockResolvedValue("de");
    render(<RootLayout />);
    await waitFor(() => expect(screen.queryByTestId("app-loading")).toBeNull());
    expect(mockTitles).toContain("Sprache");
    expect(mockTitles).not.toContain("Dil");
    expect(mockTitles).not.toContain("Language");
  });

  it("does not hang when the keychain never answers", async () => {
    jest.useFakeTimers();
    try {
      mockGetItem.mockReturnValue(new Promise(() => {}));
      render(<RootLayout />);
      expect(screen.getByTestId("app-loading")).toBeTruthy();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1500);
      });
      expect(screen.queryByTestId("app-loading")).toBeNull();
      expect(mockTitles).toContain("Dil");
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("root layout direction boot", () => {
  const reload = reloadAppAsync as jest.Mock;
  const arabicTitle = (ar as Record<string, string>)["appearance.label.language"];
  const stored = (locale: string, extra: Record<string, string> = {}) =>
    mockGetItem.mockImplementation(async (key: string) => (key === "dosya.locale" ? locale : (extra[key] ?? null)));
  const native = (isRTL: boolean, doLeftAndRightSwapInRTL: boolean) =>
    jest.spyOn(I18nManager, "getConstants").mockReturnValue({ isRTL, doLeftAndRightSwapInRTL } as never);

  beforeEach(() => reload.mockClear().mockResolvedValue(undefined));
  afterEach(() => jest.restoreAllMocks());

  it("an Arabic start in an LTR layout sets the flags, reloads once and never paints past the loading screen", async () => {
    const force = jest.spyOn(I18nManager, "forceRTL").mockImplementation(() => {});
    native(false, true);
    stored("ar");
    render(<RootLayout />);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(force).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("app-loading")).toBeTruthy();
    expect(mockTitles).toEqual([]);
  });

  it("an Arabic start in an RTL layout with the swap off paints Arabic and does not reload", async () => {
    native(true, false);
    stored("ar");
    render(<RootLayout />);
    await waitFor(() => expect(screen.queryByTestId("app-loading")).toBeNull());
    expect(mockTitles).toContain(arabicTitle);
    expect(reload).not.toHaveBeenCalled();
  });

  it("a left-to-right language in an RTL layout reloads back", async () => {
    native(true, false);
    stored("de");
    render(<RootLayout />);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("app-loading")).toBeTruthy();
  });

  it("a left-to-right start in an LTR layout never reloads", async () => {
    native(false, true);
    stored("de");
    render(<RootLayout />);
    await waitFor(() => expect(screen.queryByTestId("app-loading")).toBeNull());
    expect(reload).not.toHaveBeenCalled();
  });

  it("a reload that does not stick (guarded) paints the language in place instead of looping, and says to reopen", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    native(false, true);
    stored("ar", { "dosya.directionReloadAt": `${Date.now()}:1` });
    render(<RootLayout />);
    await waitFor(() => expect(screen.queryByTestId("app-loading")).toBeNull());
    expect(reload).not.toHaveBeenCalled();
    expect(mockTitles).toContain(arabicTitle);
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(expect.any(String), translate("appearance.description.reopenToFinishLanguageChange")),
    );
    expect(translate("appearance.description.reopenToFinishLanguageChange")).toContain(
      (ar as Record<string, string>)["appearance.description.reopenToFinishLanguageChange"].slice(0, 8),
    );
  });

  it("a recent reload toward the other direction does not block this one", async () => {
    native(false, true);
    stored("ar", { "dosya.directionReloadAt": `${Date.now()}:0` });
    render(<RootLayout />);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("app-loading")).toBeTruthy();
  });

  it("a start that needs no reload shows no reopen notice", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    native(true, false);
    stored("ar");
    render(<RootLayout />);
    await waitFor(() => expect(screen.queryByTestId("app-loading")).toBeNull());
    expect(alert).not.toHaveBeenCalled();
  });

  it("a background launch leaves the flags and the reload alone until the app is first active", async () => {
    // iOS mounts RootLayout for a backup task, a CarPlay cold start or a silent
    // push. A reload there would kill the background task, and a keychain still
    // locked before the first unlock would read the wrong choice.
    const handlers: ((state: string) => void)[] = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, h: (state: string) => void) => {
      handlers.push(h);
      return { remove: jest.fn() };
    }) as never);
    const was = AppState.currentState;
    (AppState as { currentState: unknown }).currentState = "background";
    try {
      const allow = jest.spyOn(I18nManager, "allowRTL").mockImplementation(() => {});
      const force = jest.spyOn(I18nManager, "forceRTL").mockImplementation(() => {});
      const swap = jest.spyOn(I18nManager, "swapLeftAndRightInRTL").mockImplementation(() => {});
      native(false, true);
      mockDeviceTags = ["ar-SA"];
      stored("device");
      render(<RootLayout />);
      await waitFor(() => expect(mockGetItem).toHaveBeenCalledWith("dosya.locale"));
      const reads = () => mockGetItem.mock.calls.filter(([k]) => k === "dosya.locale").length;
      const readsInBackground = reads();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(allow).not.toHaveBeenCalled();
      expect(force).not.toHaveBeenCalled();
      expect(swap).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByTestId("app-loading")).toBeTruthy();

      (AppState as { currentState: unknown }).currentState = "active";
      await act(async () => {
        for (const h of [...handlers]) h("active");
      });
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(force).toHaveBeenCalledWith(true);
      // The choice is read again once the phone is unlocked.
      expect(reads()).toBeGreaterThan(readsInBackground);
    } finally {
      (AppState as { currentState: unknown }).currentState = was;
    }
  });

  it("a reload that throws paints the language in place", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    reload.mockRejectedValue(new Error("no reload"));
    native(false, true);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    stored("he");
    render(<RootLayout />);
    await waitFor(() => expect(screen.queryByTestId("app-loading")).toBeNull());
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(expect.any(String), translate("appearance.description.reopenToFinishLanguageChange")),
    );
  });
});
