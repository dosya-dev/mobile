import {
  parseActions, isUnread, relativeTime,
  applyRead, applyReadAll, applyDismiss, mergeInboxPages, groupByDay,
  type InboxItem, type InboxState,
} from "./inbox";

function item(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "n1", kind: "personal", type: "t", category: "c", priority: "normal",
    title: "T", body: null, icon: null, link_path: null, actions: null,
    actor_name: null, created_at: 1000, read_at: null, dismissed_at: null, ...over,
  };
}

const NOW = 5000;

describe("parseActions", () => {
  it("returns [] for null, malformed JSON and non-arrays", () => {
    expect(parseActions(null)).toEqual([]);
    expect(parseActions("{oops")).toEqual([]);
    expect(parseActions('{"a":1}')).toEqual([]);
  });

  it("drops unknown handlers and entries with no label", () => {
    const json = JSON.stringify([
      { handler: "navigate", label: "Open", params: { path: "/files/a" } },
      { handler: "wipe_disk", label: "No" },
      { handler: "dismiss" },
    ]);
    expect(parseActions(json)).toEqual([
      { handler: "navigate", label: "Open", params: { path: "/files/a" } },
    ]);
  });
});

describe("isUnread / relativeTime", () => {
  it("treats a null read_at as unread", () => {
    expect(isUnread(item())).toBe(true);
    expect(isUnread(item({ read_at: 1 }))).toBe(false);
  });

  it("never goes negative for a future timestamp", () => {
    expect(relativeTime(2000, 1000)).toBe("just now");
  });

  it("steps through minutes, hours and days", () => {
    expect(relativeTime(0, 120)).toBe("2m");
    expect(relativeTime(0, 7200)).toBe("2h");
    expect(relativeTime(0, 172800)).toBe("2d");
  });
});

describe("applyRead", () => {
  it("marks one read and decrements the count", () => {
    const state: InboxState = { items: [item({ id: "a" }), item({ id: "b" })], unread: 2 };
    const next = applyRead(state, "a", NOW);
    expect(next.items.find((i) => i.id === "a")!.read_at).toBe(NOW);
    expect(next.unread).toBe(1);
  });

  it("returns the same reference for an already-read item, blocking a double decrement", () => {
    const state: InboxState = { items: [item({ id: "a", read_at: 9 })], unread: 0 };
    expect(applyRead(state, "a", NOW)).toBe(state);
  });

  it("returns the same reference for an unknown id", () => {
    const state: InboxState = { items: [item({ id: "a" })], unread: 1 };
    expect(applyRead(state, "zzz", NOW)).toBe(state);
  });

  it("never goes below zero", () => {
    const state: InboxState = { items: [item({ id: "a" })], unread: 0 };
    expect(applyRead(state, "a", NOW).unread).toBe(0);
  });
});

describe("applyReadAll", () => {
  it("reads all unread, preserves existing read_at, zeroes the count", () => {
    const state: InboxState = { items: [item({ id: "a" }), item({ id: "b", read_at: 42 })], unread: 1 };
    const next = applyReadAll(state, NOW);
    expect(next.items.find((i) => i.id === "a")!.read_at).toBe(NOW);
    expect(next.items.find((i) => i.id === "b")!.read_at).toBe(42);
    expect(next.unread).toBe(0);
  });
});

describe("applyDismiss", () => {
  it("removes the row and decrements only when it was unread", () => {
    const state: InboxState = { items: [item({ id: "a" }), item({ id: "b", read_at: 10 })], unread: 1 };
    expect(applyDismiss(state, "a")).toEqual({ items: [state.items[1]], unread: 0 });
    expect(applyDismiss(state, "b").unread).toBe(1);
  });

  it("returns the same reference for an unknown id", () => {
    const state: InboxState = { items: [item({ id: "a" })], unread: 1 };
    expect(applyDismiss(state, "zzz")).toBe(state);
  });
});

describe("mergeInboxPages", () => {
  it("dedupes by id and sorts newest first", () => {
    const merged = mergeInboxPages([
      [item({ id: "a", created_at: 100 }), item({ id: "b", created_at: 300 })],
      [item({ id: "b", created_at: 300 }), item({ id: "c", created_at: 200 })],
    ]);
    expect(merged.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("returns [] for no pages", () => {
    expect(mergeInboxPages([])).toEqual([]);
  });
});

describe("groupByDay", () => {
  it("splits on local midnight, not UTC", () => {
    const now = Math.floor(new Date(2026, 7, 12, 9, 0, 0).getTime() / 1000);
    const localMidnight = Math.floor(new Date(2026, 7, 12, 0, 0, 0).getTime() / 1000);
    const groups = groupByDay(
      [item({ id: "today", created_at: localMidnight + 60 }), item({ id: "old", created_at: localMidnight - 60 })],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Earlier"]);
  });

  it("omits an empty group", () => {
    const now = Math.floor(new Date(2026, 7, 12, 9, 0, 0).getTime() / 1000);
    expect(groupByDay([item({ created_at: now })], now).map((g) => g.label)).toEqual(["Today"]);
  });
});
