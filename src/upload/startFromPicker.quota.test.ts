import { Alert } from "react-native";
import { startFromPicker } from "./startFromPicker";
import { toast } from "@/ui/toast";
import { useUploadStore } from "./store";
import { screenDrafts } from "./limits";
import { storeBillingAvailable } from "@/billing/revenuecat";
import { queryClient } from "@/lib/queryClient";
import type { UploadDraft } from "./pickers";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/billing/revenuecat", () => ({ storeBillingAvailable: jest.fn() }));
jest.mock("./controller", () => ({ startUploads: jest.fn() }));
jest.mock("./limits", () => ({
  fetchUploadLimits: jest.fn(async () => ({})),
  screenDrafts: jest.fn(),
  summariseRejections: jest.fn(() => "blocked"),
}));
jest.mock("@/backup/livePhoto", () => ({ discardLivePhotoTemp: jest.fn(async () => {}) }));

const draft = { name: "a.jpg", uri: "file:///a.jpg", sizeBytes: 10, mimeType: "image/jpeg" } as unknown as UploadDraft;
const run = () => startFromPicker({ picker: async () => [draft], workspaceId: "ws_1", folderId: null });
const setRole = (role_id: string) => queryClient.setQueryData(["workspaces"], [{ id: "ws_1", role_id }]);

describe("startFromPicker quota-over", () => {
  let alertSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    queryClient.clear();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    useUploadStore.setState({ items: [] });
    (screenDrafts as jest.Mock).mockImplementation((d: UploadDraft[]) => ({ accepted: d, rejected: [], quotaOver: 1 }));
    (storeBillingAvailable as jest.Mock).mockReturnValue(true);
  });

  it("offers Get more space to the owner on a store build, and the action opens the paywall", async () => {
    setRole("role_owner");
    await run();
    expect(toast).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    expect(buttons.map((b) => b.text)).toEqual(["Close", "Get more space"]);
    buttons[1].onPress?.();
    expect(mockPush).toHaveBeenCalledWith("/upgrade");
  });

  it("keeps the plain toast for a non-owner", async () => {
    setRole("role_editor");
    await run();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("keeps the plain toast when billing is unavailable", async () => {
    setRole("role_owner");
    (storeBillingAvailable as jest.Mock).mockReturnValue(false);
    await run();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("keeps the plain toast when the workspace role is not known yet", async () => {
    await run();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
