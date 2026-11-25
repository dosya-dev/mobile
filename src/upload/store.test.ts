import { useUploadStore } from "./store";
import type { UploadItem } from "./types";

const mk = (id: string): UploadItem => ({ id, name: id + ".jpg", uri: "file://" + id, size: 10, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "queued", progress: 0 });

beforeEach(() => useUploadStore.setState({ items: [] }));

describe("uploadStore", () => {
  it("enqueues items", () => {
    useUploadStore.getState().enqueue([mk("a"), mk("b")]);
    expect(useUploadStore.getState().items).toHaveLength(2);
  });
  it("patches an item by id", () => {
    useUploadStore.getState().enqueue([mk("a")]);
    useUploadStore.getState().patch("a", { status: "uploading", progress: 0.5 });
    expect(useUploadStore.getState().items[0].progress).toBe(0.5);
    expect(useUploadStore.getState().items[0].status).toBe("uploading");
  });
  it("removes and clears finished", () => {
    useUploadStore.getState().enqueue([mk("a"), mk("b")]);
    useUploadStore.getState().patch("a", { status: "done" });
    useUploadStore.getState().clearFinished();
    expect(useUploadStore.getState().items.map((i) => i.id)).toEqual(["b"]);
    useUploadStore.getState().remove("b");
    expect(useUploadStore.getState().items).toHaveLength(0);
  });
});

describe("settled-item folding (flat RAM during long runs)", () => {
  it("folds done bk_ items into counters and leaves everything else alone", () => {
    useUploadStore.setState({
      items: [
        { id: "bk_1", name: "a", uri: "u", size: 100, mime: "m", folderId: null, workspaceId: "w", status: "done", progress: 1 },
        { id: "bk_2", name: "b", uri: "u", size: 50, mime: "m", folderId: null, workspaceId: "w", status: "uploading", progress: 0.5 },
        { id: "manual_1", name: "c", uri: "u", size: 10, mime: "m", folderId: null, workspaceId: "w", status: "done", progress: 1 },
      ],
      settledBk: { count: 0, bytes: 0 },
    });
    useUploadStore.getState().foldSettledBk();
    const s = useUploadStore.getState();
    expect(s.items.map((i) => i.id)).toEqual(["bk_2", "manual_1"]);
    expect(s.settledBk).toEqual({ count: 1, bytes: 100 });
    useUploadStore.getState().resetSettledBk();
    expect(useUploadStore.getState().settledBk).toEqual({ count: 0, bytes: 0 });
  });
});
