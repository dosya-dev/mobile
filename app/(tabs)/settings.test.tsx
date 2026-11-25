import { render, screen, fireEvent, waitFor, within } from "@testing-library/react-native";
import { ScrollView } from "react-native";
import SettingsScreen from "./settings";
import { useAuthStore } from "@/auth/authStore";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";
import { useAppearance } from "@/theme/themeStore";
import { useWorkspaceDashboard } from "@/workspace-dashboard/api";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
// Stub the workspace context bar - it needs a query client and secure-store, and its
// behaviour is covered by WorkspaceSwitcher.test.
jest.mock("@/files/WorkspaceHeader", () => ({ WorkspaceHeader: () => null }));
// The account card reads /api/me for the avatar; stub the hook so this suite doesn't
// need a query client. `data: null` is the no-avatar case - the card falls back to initials.
jest.mock("@/profile/hooks", () => ({ useMe: () => ({ data: null }) }));
// The storage meter reads the same endpoint as the dashboard; no query client here either.
jest.mock("@/workspace-dashboard/api", () => ({ useWorkspaceDashboard: jest.fn(() => ({ data: undefined })) }));
// The version line reads the INSTALLED binary through expo-application, not the
// config. expo-constants is only the fallback for a build that has no native
// version at all (Expo Go, web) - the mocks below give it a distinct value so a
// regression that read the config again would show up as the wrong string
// rather than passing by coincidence.
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "0.0.0-config" } } }));
jest.mock("expo-application", () => ({
  __esModule: true,
  nativeApplicationVersion: "1.0.1",
  nativeBuildVersion: "36",
}));
jest.mock("@/files/cacheControl", () => ({
  getCacheSizeBytes: jest.fn(async () => 1.5 * 1_073_741_824),
  clearCaches: jest.fn(async () => {}),
}));
// Billing entry points are covered by settings.upgrade.test; here they just stay out of the way.
jest.mock("@/billing/revenuecat", () => ({ storeBillingAvailable: () => false }));
jest.mock("@/billing/hooks", () => ({ useEligibility: () => ({ data: undefined }), useStoreStatus: () => ({ data: null }) }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
import { getCacheSizeBytes, clearCaches } from "@/files/cacheControl";
import { useUploadStore } from "@/upload/store";
import { toast } from "@/ui/toast";

const mockDashboard = useWorkspaceDashboard as jest.Mock;

const GB = 1_073_741_824;

describe("SettingsScreen", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockDashboard.mockReturnValue({ data: undefined });
    useAuthStore.setState({ status: "signedIn", user: { id: "u", email: "a@b.com", name: "A", created_at: 1 }, pending2fa: null, error: null });
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS }, hydrated: true });
    useAppearance.setState({ mode: "system" });
  });

  describe("cache control", () => {
    beforeEach(() => {
      (getCacheSizeBytes as jest.Mock).mockClear();
      (getCacheSizeBytes as jest.Mock).mockResolvedValue(1.5 * GB);
      (clearCaches as jest.Mock).mockClear();
      (toast as jest.Mock).mockClear();
      useUploadStore.setState({ items: [] });
    });

    it("shows how much the cache holds, and clears it on request", async () => {
      render(<SettingsScreen />);
      expect(await screen.findByText("1.5 GB")).toBeTruthy();
      (getCacheSizeBytes as jest.Mock).mockResolvedValue(0);
      fireEvent.press(screen.getByTestId("settings-clear-cache"));
      await waitFor(() => expect(clearCaches).toHaveBeenCalledTimes(1));
      // The cache row's value (the offline files row below it has its own size).
      expect(await within(screen.getByTestId("settings-cache-size")).findByText("0 B")).toBeTruthy();
    });

    it("keeps the staged files of error rows the queue can still retry", async () => {
      useUploadStore.setState({
        items: [
          { id: "up_1_1000", name: "a.pdf", uri: "file:///cache/upload-share-1.pdf", size: 1, mime: "application/pdf", folderId: null, workspaceId: "w1", status: "error", progress: 0, error: "Interrupted - tap to retry" },
          { id: "up_2_2000", name: "b.pdf", uri: "file:///cache/upload-share-2.pdf", size: 1, mime: "application/pdf", folderId: null, workspaceId: "w1", status: "done", progress: 1 },
        ],
      });
      render(<SettingsScreen />);
      await screen.findByText("1.5 GB");
      fireEvent.press(screen.getByTestId("settings-clear-cache"));
      await waitFor(() => expect(clearCaches).toHaveBeenCalledTimes(1));
      // The retryable row's staged copy is spared; the finished one is not.
      expect(clearCaches).toHaveBeenCalledWith({ keep: new Set(["file:///cache/upload-share-1.pdf"]) });
    });

    it("refuses to clear while an upload is staged in the cache", async () => {
      useUploadStore.setState({
        items: [{ id: "up_1_1000", name: "a.pdf", uri: "file:///cache/upload-share-1.pdf", size: 1, mime: "application/pdf", folderId: null, workspaceId: "w1", status: "uploading", progress: 0.2 }],
      });
      render(<SettingsScreen />);
      await screen.findByText("1.5 GB");
      fireEvent.press(screen.getByTestId("settings-clear-cache"));
      await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/upload/i), "error"));
      expect(clearCaches).not.toHaveBeenCalled();
    });
  });

  it("can be scrolled to reach the rows past the fold", () => {
    render(<SettingsScreen />);
    expect(screen.UNSAFE_getAllByType(ScrollView).length).toBeGreaterThan(0);
  });

  it("shows the signed-in user's email", () => {
    render(<SettingsScreen />);
    expect(screen.getByText("a@b.com")).toBeTruthy();
  });

  it("opens the profile from the account card", () => {
    render(<SettingsScreen />);
    fireEvent.press(screen.getByTestId("settings-account"));
    expect(mockPush).toHaveBeenCalledWith("/profile");
  });

  it("has no duplicate Profile row - the account card is the one way in", () => {
    render(<SettingsScreen />);
    expect(screen.queryByTestId("settings-profile")).toBeNull();
  });

  it("shows storage usage on the account card once the dashboard resolves", () => {
    mockDashboard.mockReturnValue({ data: { total: { used_bytes: GB, limit_bytes: 5 * GB, free_bytes: 4 * GB } } });
    render(<SettingsScreen />);
    expect(screen.getByText("1.0 GB of 5.0 GB used")).toBeTruthy();
  });

  it("omits the storage line while the dashboard is loading", () => {
    render(<SettingsScreen />);
    expect(screen.queryByTestId("settings-usage")).toBeNull();
  });

  it.each([
    ["settings-favourites", "/favourites"],
    ["settings-shares", "/shares"],
    ["settings-trash", "/trash"],
    ["settings-duplicates", "/duplicates"],
    ["settings-map", "/map"],
    ["settings-file-requests", "/file-requests"],
    ["settings-groups", "/groups"],
    ["settings-contacts", "/contacts"],
  ] as const)("navigates from the %s shortcut tile", (testID, route) => {
    render(<SettingsScreen />);
    fireEvent.press(screen.getByTestId(testID));
    expect(mockPush).toHaveBeenCalledWith(route);
  });

  it.each([
    ["settings-workspaces", "/workspaces"],
    ["settings-workspace-dashboard", "/workspace-dashboard"],
    ["settings-activity", "/activity"],
    ["settings-backup", "/backup-settings"],
    ["settings-notifications", "/notification-settings"],
    ["settings-appearance", "/appearance"],
    ["settings-language", "/language"],
    ["settings-security", "/security"],
  ] as const)("navigates from the %s row", (testID, route) => {
    render(<SettingsScreen />);
    fireEvent.press(screen.getByTestId(testID));
    expect(mockPush).toHaveBeenCalledWith(route);
  });

  // Language sits right under Appearance and names the current choice.
  it("shows the language choice under Appearance", () => {
    render(<SettingsScreen />);
    expect(screen.getByTestId("settings-language")).toBeTruthy();
    expect(screen.getByText("Device language")).toBeTruthy();
  });

  it("offers the Vault from Storage and opens it inside the Files tab", () => {
    render(<SettingsScreen />);
    expect(screen.getByTestId("settings-vault")).toBeTruthy();
    expect(screen.getByText("End-to-end encrypted Spaces")).toBeTruthy();
    fireEvent.press(screen.getByTestId("settings-vault"));
    // The Vault screen lives in the Files tab's stack, so the tab bar stays up.
    expect(mockPush).toHaveBeenCalledWith("/vault");
  });

  it("reports whether backup is on without opening the screen", () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true }, hydrated: true });
    render(<SettingsScreen />);
    expect(screen.getByText("On")).toBeTruthy();
  });

  it("reports the appearance mode without opening the screen", () => {
    useAppearance.setState({ mode: "dark" });
    render(<SettingsScreen />);
    expect(screen.getByText("Dark")).toBeTruthy();
  });

  it("no longer hosts the biometrics toggle - it lives on the Security screen", () => {
    render(<SettingsScreen />);
    expect(screen.queryByText("Unlock with biometrics")).toBeNull();
  });

  it("shows the installed version and build number", () => {
    // "1.0.1 (36)" - the build number is the half that matters for a bug
    // report, and it is invisible in app.config.ts because EAS assigns it
    // remotely. "0.0.0-config" appearing here would mean the screen went back
    // to reading the inert config literal.
    render(<SettingsScreen />);
    expect(screen.getByTestId("settings-version")).toHaveTextContent("Version 1.0.1 (36)");
    expect(screen.queryByText("Version 0.0.0-config")).toBeNull();
  });

  it("calls signOut when Sign out is pressed", () => {
    const signOut = jest.fn();
    useAuthStore.setState({ signOut } as never);
    render(<SettingsScreen />);
    fireEvent.press(screen.getByText("Sign out"));
    expect(signOut).toHaveBeenCalled();
  });
});
