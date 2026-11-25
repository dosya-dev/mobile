import { startFromPicker } from "./startFromPicker";
import { toast } from "@/ui/toast";
import { useUploadStore } from "./store";
import { startUploads } from "./controller";
import { fetchUploadLimits, screenDrafts } from "./limits";
import type { UploadDraft } from "./pickers";

jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("./controller", () => ({ startUploads: jest.fn() }));
jest.mock("./limits", () => ({
  fetchUploadLimits: jest.fn(async () => ({})),
  screenDrafts: jest.fn(),
  summariseRejections: jest.fn(() => "2 files were blocked"),
}));
// Named with a `mock` prefix: babel-plugin-jest-hoist only allows a
// jest.mock() factory to reference out-of-scope variables that are either
// "pure" (e.g. object/array literals) or explicitly escape-hatched via a
// `mock`-prefixed name - see pickers.test.ts for the same mechanism.
const mockDiscardLivePhotoTemp = jest.fn(async (..._a: unknown[]) => {});
jest.mock("@/backup/livePhoto", () => ({ discardLivePhotoTemp: (...a: unknown[]) => mockDiscardLivePhotoTemp(...(a as [never])) }));

const draft = (name: string): UploadDraft =>
  ({ name, uri: `file:///${name}`, sizeBytes: 10, mimeType: "image/jpeg" }) as unknown as UploadDraft;

const run = (picked: UploadDraft[]) =>
  startFromPicker({ picker: async () => picked, workspaceId: "ws_1", folderId: null });

describe("startFromPicker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useUploadStore.setState({ items: [] });
    (screenDrafts as jest.Mock).mockImplementation((drafts: UploadDraft[]) => ({
      accepted: drafts,
      rejected: [],
      quotaOver: 0,
    }));
  });

  it("starts the upload without interrupting the person to confirm it", async () => {
    // `toast` is Alert.alert - a native modal with an OK button. Announcing a
    // thing the person just asked for, by blocking the screen, is the bug this
    // guards. The orbit disc reports the start instead.
    await run([draft("a.jpg"), draft("b.jpg")]);

    expect(startUploads).toHaveBeenCalledTimes(1);
    expect(useUploadStore.getState().items).toHaveLength(2);
    expect(toast).not.toHaveBeenCalled();
  });

  it("still speaks up when files were blocked, which the person did not ask for", async () => {
    (screenDrafts as jest.Mock).mockReturnValue({
      accepted: [draft("ok.jpg")],
      rejected: [draft("bad.exe")],
      quotaOver: 0,
    });
    await run([draft("ok.jpg"), draft("bad.exe")]);
    expect(toast).toHaveBeenCalledWith("2 files were blocked", "error");
  });

  it("still warns when the batch may not fit", async () => {
    (screenDrafts as jest.Mock).mockReturnValue({
      accepted: [draft("big.mov")],
      rejected: [],
      quotaOver: 1,
    });
    await run([draft("big.mov")]);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("may not fit"), "error");
  });

  it("does nothing at all when the picker was dismissed", async () => {
    await run([]);
    expect(fetchUploadLimits).not.toHaveBeenCalled();
    expect(startUploads).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("does nothing without a workspace to upload into", async () => {
    await startFromPicker({ picker: async () => [draft("a.jpg")], workspaceId: null, folderId: null });
    expect(startUploads).not.toHaveBeenCalled();
  });

  it("drops a Live Photo's twin too when its still is refused", async () => {
    (screenDrafts as jest.Mock).mockImplementation((drafts: UploadDraft[]) => ({
      accepted: drafts.filter((d) => d.name !== "bad.heic"),
      rejected: [{ name: "bad.heic", reason: "blocked extension" }],
      quotaOver: 0,
    }));
    const twin = { ...draft("bad.MOV"), pairedTempUri: "file:///cache/dosya-live-photos/bad.mov" } as UploadDraft;
    await run([draft("bad.heic"), twin]);
    expect(useUploadStore.getState().items).toHaveLength(0);
    expect(startUploads).not.toHaveBeenCalled();
    expect(mockDiscardLivePhotoTemp).toHaveBeenCalledWith("file:///cache/dosya-live-photos/bad.mov");
  });

  it("keeps a Live Photo's twin when its still passes too", async () => {
    const twin = { ...draft("ok.MOV"), pairedTempUri: "file:///cache/dosya-live-photos/ok.mov" } as UploadDraft;
    await run([draft("ok.heic"), twin]);
    expect(useUploadStore.getState().items).toHaveLength(2);
  });

  it("keeps the still (and anything after) when only its twin is refused", async () => {
    (screenDrafts as jest.Mock).mockImplementation((drafts: UploadDraft[]) => ({
      accepted: drafts.filter((d) => d.name !== "bad.MOV"),
      rejected: [{ name: "bad.MOV", reason: "blocked extension" }],
      quotaOver: 0,
    }));
    const twin = { ...draft("bad.MOV"), pairedTempUri: "file:///cache/dosya-live-photos/bad.mov" } as UploadDraft;
    await run([draft("still.heic"), twin, draft("other.jpg")]);
    expect(useUploadStore.getState().items.map((i) => i.name)).toEqual(["still.heic", "other.jpg"]);
  });
});
