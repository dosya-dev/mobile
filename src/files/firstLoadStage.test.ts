import { deriveFirstLoadStage } from "./firstLoadStage";

// The bar is truthful: each advance means a real thing finished loading, in a
// fixed order - account, workspace, files. The percentages are the design's
// fixed stops; they must never move backwards as inputs flip on.

it("starts at the account stage with the bar barely started", () => {
  const s = deriveFirstLoadStage({ hasUser: false, workspaceReady: false, filesReady: false });
  expect(s).toEqual({ phase: "account", pct: 8, label: "Signing you in…" });
});

it("advances to the workspace stage once the profile is present", () => {
  const s = deriveFirstLoadStage({ hasUser: true, workspaceReady: false, filesReady: false });
  expect(s).toEqual({ phase: "workspace", pct: 41, label: "Opening your workspace…" });
});

it("advances to the files stage once a workspace is chosen", () => {
  const s = deriveFirstLoadStage({ hasUser: true, workspaceReady: true, filesReady: false });
  expect(s).toEqual({ phase: "files", pct: 74, label: "Fetching your files…" });
});

it("completes when the first listing lands", () => {
  const s = deriveFirstLoadStage({ hasUser: true, workspaceReady: true, filesReady: true });
  expect(s.phase).toBe("done");
  expect(s.pct).toBe(100);
});

// Out-of-order arrivals happen (the listing can land while the profile fetch
// is still in flight). The bar reports the EARLIEST unfinished stage - it
// never skips ahead of the truth.
it("stays on the earliest unfinished stage when later signals arrive first", () => {
  const s = deriveFirstLoadStage({ hasUser: false, workspaceReady: true, filesReady: true });
  expect(s.phase).toBe("account");
  expect(s.pct).toBe(8);
});
