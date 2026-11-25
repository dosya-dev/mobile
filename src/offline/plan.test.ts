import { accessIdsToAsk, planSync, type AccessCheck, type MembershipCheck } from "./plan";
import type { DesiredFile, OfflineFileRow, PinMember } from "./types";

const want = (id: string, over: Partial<DesiredFile> = {}): DesiredFile => ({
  file_id: id, workspace_id: "w1", folder_id: "fo", name: `${id}.txt`, extension: "txt", mime_type: "text/plain",
  size_bytes: 10, current_version: 1, updated_at: 1, lock_mode: "none", ...over,
});

const saved = (id: string, over: Partial<OfflineFileRow> = {}): OfflineFileRow => ({
  file_id: id, workspace_id: "w1", folder_id: "fo", name: `${id}.txt`, extension: "txt", mime_type: "text/plain",
  size_bytes: 10, remote_version: 1, saved_version: 1, saved_size: 10, rendition: "none", rendition_version: null,
  rendition_size: null, updated_at: 1, ...over,
});

const member = (pin_id: string, file_id: string, missing_count = 0): PinMember => ({ pin_id, file_id, missing_count });
const ok = (pinId: string, files: DesiredFile[], revision = 1): MembershipCheck =>
  ({ pinId, revision, outcome: "ok", files, folders: [] });
const allowed = (ids: string[], workspaceId = "w1"): AccessCheck =>
  ({ workspaceId, outcome: "ok", allowed: new Set(ids), denied: new Set() });

describe("planSync", () => {
  it("a folder moved out of pin A but covered by pin B is kept", () => {
    // Pin A no longer lists x (moved out), pin B (the moved folder's own pin) does.
    const local = [saved("x")];
    const members = [member("A", "x"), member("B", "x")];
    const plan = planSync([ok("A", []), ok("B", [want("x")])], [allowed(["x"])], local, members);
    expect(plan.denied).toEqual([]);
    expect(plan.membership).toEqual(expect.arrayContaining([
      { pinId: "A", present: [], missing: ["x"] },
      { pinId: "B", present: ["x"], missing: [] },
    ]));
    expect(plan.transfer).toEqual([]);
  });

  it("absence alone never denies; second miss only drops that membership", () => {
    const local = [saved("x")];
    const members = [member("A", "x", 1)];
    const plan = planSync([ok("A", [])], [allowed([])], local, members);
    expect(plan.denied).toEqual([]);
    expect(plan.membership).toEqual([{ pinId: "A", present: [], missing: ["x"] }]);
  });

  it("gone pin drops its memberships; files covered elsewhere stay", () => {
    const local = [saved("x"), saved("y")];
    const members = [member("A", "x"), member("A", "y"), member("B", "x")];
    const plan = planSync([{ pinId: "A", revision: 1, outcome: "gone" }, ok("B", [want("x")])], [allowed(["x", "y"])], local, members);
    expect(plan.goneByPin).toEqual(["A"]);
    expect(plan.denied).toEqual([]);
    expect(plan.membership).toEqual([{ pinId: "B", present: ["x"], missing: [] }]);
  });

  it("a per-file denied decision denies even with two covering pins", () => {
    const local = [saved("x")];
    const members = [member("A", "x"), member("B", "x")];
    const access: AccessCheck = { workspaceId: "w1", outcome: "ok", allowed: new Set(), denied: new Set(["x"]) };
    const plan = planSync([ok("A", [want("x")]), ok("B", [want("x")])], [access], local, members);
    expect(plan.denied).toEqual(["x"]);
    expect(plan.transfer).toEqual([]);
    expect(plan.upsertMeta).toEqual([]);
  });

  it("one out-of-scope file denied alone; its workspace's other files untouched", () => {
    const local = [saved("in1"), saved("out"), saved("in2")];
    const access: AccessCheck = { workspaceId: "w1", outcome: "ok", allowed: new Set(["in1", "in2"]), denied: new Set(["out"]) };
    const plan = planSync([ok("A", [want("in1"), want("out"), want("in2")])], [access], local, [member("A", "in1"), member("A", "out"), member("A", "in2")]);
    expect(plan.denied).toEqual(["out"]);
    expect(plan.upsertMeta.map((f) => f.file_id).sort()).toEqual(["in1", "in2"]);
  });

  it("workspace_denied denies every saved file in that workspace", () => {
    const local = [saved("a"), saved("b"), saved("other", { workspace_id: "w2" }), saved("pending", { saved_version: null })];
    const plan = planSync(
      [ok("A", [want("a"), want("b"), want("new")])],
      [{ workspaceId: "w1", outcome: "workspace_denied" }],
      local,
      [member("A", "a"), member("A", "b"), member("A", "pending"), member("B", "other")],
    );
    expect(plan.denied.sort()).toEqual(["a", "b", "new", "pending"]);
    expect(plan.transfer).toEqual([]);
    expect(plan.upsertMeta).toEqual([]);
  });

  it.each([
    ["401", "unknown"],
    ["uncoded 403", "unknown"],
    ["429", "unknown"],
    ["5xx", "unknown"],
  ])("access unknown (%s): no denial and no transfer", (_label) => {
    const local = [saved("a"), saved("b", { saved_version: null })];
    const plan = planSync(
      [ok("A", [want("a", { current_version: 2 }), want("b")])],
      [{ workspaceId: "w1", outcome: "unknown" }],
      local,
      [member("A", "a"), member("A", "b")],
    );
    expect(plan.denied).toEqual([]);
    expect(plan.transfer).toEqual([]);
    // Membership and metadata are a different question and still apply.
    expect(plan.membership).toEqual([{ pinId: "A", present: ["a", "b"], missing: [] }]);
  });

  it("no access answer at all for a workspace is the same as unknown", () => {
    const plan = planSync([ok("A", [want("a", { current_version: 2 })])], [], [saved("a")], [member("A", "a")]);
    expect(plan.denied).toEqual([]);
    expect(plan.transfer).toEqual([]);
  });

  it.each(["full_lock", "view_only"])("lock_mode %s denies", (lock) => {
    const plan = planSync([ok("A", [want("a", { lock_mode: lock })])], [allowed(["a"])], [saved("a")], [member("A", "a")]);
    expect(plan.denied).toEqual(["a"]);
    expect(plan.transfer).toEqual([]);
  });

  it("missing lock_mode keeps the saved copy and blocks its transfer", () => {
    const plan = planSync(
      [ok("A", [want("a", { lock_mode: "", current_version: 2 }), want("b", { lock_mode: "" })])],
      [allowed(["a", "b"])],
      [saved("a")],
      [member("A", "a"), member("A", "b")],
    );
    expect(plan.denied).toEqual([]);
    expect(plan.transfer).toEqual([]);
    expect(plan.upsertMeta.map((f) => f.file_id)).toEqual(["a", "b"]);
  });

  it("version bump transfers and does not touch the saved version", () => {
    const local = [saved("a")];
    const plan = planSync([ok("A", [want("a", { current_version: 2 })])], [allowed(["a"])], local, [member("A", "a")]);
    expect(plan.transfer.map((f) => [f.file_id, f.current_version])).toEqual([["a", 2]]);
    expect(local[0].saved_version).toBe(1);
  });

  it("an unsaved covered file with access transfers; a current one does not", () => {
    const plan = planSync(
      [ok("A", [want("new"), want("cur")])],
      [allowed(["new", "cur"])],
      [saved("cur")],
      [member("A", "cur")],
    );
    expect(plan.transfer.map((f) => f.file_id)).toEqual(["new"]);
  });

  it("file moving from pin A to pin B in one run is never orphaned", () => {
    const members = [member("A", "x", 1)];
    const plan = planSync([ok("A", []), ok("B", [want("x")])], [allowed(["x"])], [saved("x")], members);
    expect(plan.denied).toEqual([]);
    expect(plan.membership).toEqual(expect.arrayContaining([
      { pinId: "A", present: [], missing: ["x"] },
      { pinId: "B", present: ["x"], missing: [] },
    ]));
    expect(plan.upsertMeta.map((f) => f.file_id)).toEqual(["x"]);
  });

  it("a skipped pin changes nothing", () => {
    const plan = planSync([{ pinId: "A", revision: 1, outcome: "skipped" }], [allowed(["x"])], [saved("x")], [member("A", "x")]);
    expect(plan.membership).toEqual([]);
    expect(plan.goneByPin).toEqual([]);
    expect(plan.denied).toEqual([]);
  });

  it("carries folder rows for complete checks", () => {
    const folders = [{ id: "A", workspace_id: "w1", parent_id: null, name: "A", pin_id: "A" }];
    const plan = planSync([{ pinId: "A", revision: 1, outcome: "ok", files: [], folders }], [], [], []);
    expect(plan.folders).toEqual([{ pinId: "A", rows: folders }]);
  });
});

describe("accessIdsToAsk", () => {
  it("accessIdsToAsk includes fully saved files with nothing to transfer", () => {
    const local = [saved("a"), saved("b", { workspace_id: "w2" })];
    const asked = accessIdsToAsk(local, [ok("A", [want("a")])]);
    expect(asked.get("w1")).toEqual(["a"]);
    expect(asked.get("w2")).toEqual(["b"]);
  });

  it("adds files a complete check wants that are not saved at the current version", () => {
    const asked = accessIdsToAsk([saved("a")], [ok("A", [want("a", { current_version: 2 }), want("n"), want("locked", { lock_mode: "view_only" })])]);
    expect(asked.get("w1")?.sort()).toEqual(["a", "n"]);
  });

  it("leaves out rows that hold no bytes and nothing wants", () => {
    const asked = accessIdsToAsk([saved("p", { saved_version: null })], []);
    expect(asked.size).toBe(0);
  });
});
