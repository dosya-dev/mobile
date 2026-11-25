import { useDownloadStore } from "./downloadStore";

const s = () => useDownloadStore.getState();

describe("useDownloadStore", () => {
  beforeEach(() => s().clearAll());

  it("opens an entry in the preparing phase, with no total known yet", () => {
    s().start("f1", "match.mp4", 1_000);
    const e = s().entries["f1"];
    expect(e).toMatchObject({ fileId: "f1", name: "match.mp4", phase: "preparing", written: 0, total: 0 });
    expect(e.startedAt).toBe(1_000);
  });

  it("moves to downloading and carries the byte counts once they arrive", () => {
    s().start("f1", "match.mp4", 1_000);
    s().progress("f1", 50, 200);
    expect(s().entries["f1"]).toMatchObject({ phase: "downloading", written: 50, total: 200 });
  });

  // The entry is keyed by file id precisely so leaving the viewer does not lose
  // it. A progress tick for a file nobody started is a stale callback from a
  // cancelled download and must not resurrect a row.
  it("ignores progress for a file that was never started", () => {
    s().progress("ghost", 10, 20);
    expect(s().entries["ghost"]).toBeUndefined();
  });

  it("keeps other files untouched when one of them progresses", () => {
    s().start("f1", "a.mp4", 1_000);
    s().start("f2", "b.mp4", 1_000);
    const before = s().entries["f2"];
    s().progress("f1", 10, 100);
    // Identity preserved, so a memoised row for f2 does not re-render.
    expect(s().entries["f2"]).toBe(before);
  });

  it("tracks the unmeasurable save phase separately from the transfer", () => {
    s().start("f1", "match.mp4", 1_000);
    s().progress("f1", 200, 200);
    s().setPhase("f1", "saving");
    expect(s().entries["f1"].phase).toBe("saving");
  });

  it("records why a download failed, keeping the bytes already on disk", () => {
    s().start("f1", "match.mp4", 1_000);
    s().progress("f1", 120, 500);
    s().fail("f1", "Connection lost");
    expect(s().entries["f1"]).toMatchObject({ phase: "error", written: 120, message: "Connection lost" });
  });

  it("clears one entry without disturbing the rest", () => {
    s().start("f1", "a.mp4", 1_000);
    s().start("f2", "b.mp4", 1_000);
    s().clear("f1");
    expect(s().entries["f1"]).toBeUndefined();
    expect(s().entries["f2"]).toBeDefined();
  });

  it("counts only the transfers still moving, so a finished one leaves the dock", () => {
    s().start("f1", "a.mp4", 1_000);
    s().start("f2", "b.mp4", 1_000);
    s().setPhase("f2", "done");
    expect(s().activeIds()).toEqual(["f1"]);
  });

  it("treats a failed transfer as still present, since it is waiting on a retry", () => {
    s().start("f1", "a.mp4", 1_000);
    s().fail("f1", "offline");
    expect(s().activeIds()).toEqual([]);
    expect(s().entries["f1"]).toBeDefined();
  });
});

describe("workspace provenance", () => {
  beforeEach(() => s().clearAll());

  it("records where the transfer started, so a workspace switch cannot orphan it", () => {
    s().start("f1", "match.mp4", 1_000, { id: "w1", name: "Design team" });
    expect(s().entries["f1"]).toMatchObject({ workspaceId: "w1", workspaceName: "Design team" });
  });

  it("survives without one, because a file row need not know its workspace", () => {
    s().start("f1", "match.mp4", 1_000);
    expect(s().entries["f1"].workspaceId).toBeUndefined();
  });

  it("keeps the workspace across progress, saving and failure", () => {
    s().start("f1", "match.mp4", 1_000, { id: "w1", name: "Design team" });
    s().progress("f1", 10, 100);
    s().setPhase("f1", "saving");
    s().fail("f1", "offline");
    expect(s().entries["f1"]).toMatchObject({ workspaceId: "w1", workspaceName: "Design team" });
  });
});
