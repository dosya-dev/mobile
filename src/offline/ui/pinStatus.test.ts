jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));

import { pinStatusLine, type PinSummary } from "./pinStatus";
import { fileBadgeState, folderBadgeState } from "./offlineState";
import type { PinRow, PinStatus } from "../types";

const NOW = 1_800_000_000_000;
const pin = (status: PinStatus, over: Partial<PinRow> = {}): PinRow => ({
  id: "p", kind: "folder", workspace_id: "w1", name: "P", created_at: 1, revision: 1, status, last_checked_at: NOW - 5 * 60_000, last_error: null, ...over,
});
const saved: PinSummary = { files: 3, saved: 2, bytes: 100 };
const none: PinSummary = { files: 3, saved: 0, bytes: 0 };

describe("pinStatusLine: each status", () => {
  it.each<[PinStatus, PinSummary, string]>([
    ["ready", saved, "Checked 5 minutes ago"],
    ["update_pending", saved, "Saved version · update pending"],
    ["waiting_wifi", saved, "Saved version · update waiting for Wi-Fi"],
    ["no_space", saved, "Saved version · update waiting for space"],
    ["over_budget", saved, "Saved version · update waiting for budget"],
    ["waiting_wifi", none, "Waiting for Wi-Fi"],
    ["no_space", none, "Not enough space on this phone"],
    ["over_budget", none, "Over your offline storage budget"],
    ["error", saved, "Couldn't check · last checked 5 minutes ago"],
    ["gone", saved, "You no longer have access"],
    ["checking", none, "Checking for changes"],
    ["transferring", none, "Downloading"],
    ["pending", none, "Waiting to download"],
  ])("%s (%o)", (status, summary, line) => {
    expect(pinStatusLine(pin(status), summary, NOW)).toBe(line);
  });

  it("never checked", () => {
    expect(pinStatusLine(pin("ready", { last_checked_at: null }), saved, NOW)).toBe("Not checked yet");
    expect(pinStatusLine(pin("error", { last_checked_at: null }), saved, NOW)).toBe("Couldn't check");
  });
});

describe("badge states", () => {
  const s = (over: Partial<{ savedFileIds: Set<string>; updatePendingIds: Set<string>; pins: PinRow[] }> = {}) => ({
    savedFileIds: new Set<string>(), updatePendingIds: new Set<string>(), pins: [] as PinRow[], ...over,
  });

  it("a file: saved, update pending, transferring, or nothing", () => {
    expect(fileBadgeState("a", s({ savedFileIds: new Set(["a"]) }))).toBe("saved");
    expect(fileBadgeState("a", s({ savedFileIds: new Set(["a"]), updatePendingIds: new Set(["a"]) }))).toBe("update_pending");
    expect(fileBadgeState("a", s({ pins: [pin("transferring", { id: "a", kind: "file" })] }))).toBe("transferring");
    expect(fileBadgeState("a", s())).toBeNull();
  });

  it("a folder pin follows its status, and a gone pin has no badge", () => {
    expect(folderBadgeState("p", [pin("ready")])).toBe("saved");
    expect(folderBadgeState("p", [pin("checking")])).toBe("transferring");
    expect(folderBadgeState("p", [pin("waiting_wifi")])).toBe("update_pending");
    expect(folderBadgeState("p", [pin("gone")])).toBeNull();
    expect(folderBadgeState("q", [pin("ready")])).toBeNull();
  });
});
