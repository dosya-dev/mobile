import {
  dayLabel, groupByDay, quotedParent, canEdit, canDelete, isRunStart, QUOTE_LENGTH,
} from "./thread";
import type { CommentRow } from "./api";

const DAY = 86400;

function c(over: Partial<CommentRow> = {}): CommentRow {
  return {
    id: "c1", file_id: "f1", folder_id: null, workspace_id: "w1",
    user_id: "u1", parent_id: null, body: "hello", is_edited: 0,
    created_at: 1_700_000_000, updated_at: 1_700_000_000,
    user_name: "Ada", user_email: "ada@example.com", user_avatar: null,
    ...over,
  };
}

describe("dayLabel", () => {
  const now = new Date("2026-08-13T10:00:00Z").getTime() / 1000;

  it("names today and yesterday rather than printing a date", () => {
    expect(dayLabel(now, now)).toBe("Today");
    expect(dayLabel(now - DAY, now)).toBe("Yesterday");
  });

  it("writes out anything older", () => {
    // Not asserting an exact locale string - asserting it is neither of the
    // relative labels, which is the behaviour that matters.
    const label = dayLabel(now - DAY * 9, now);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label.length).toBeGreaterThan(4);
  });
});

describe("groupByDay", () => {
  const now = new Date("2026-08-13T10:00:00Z").getTime() / 1000;

  it("puts comments from the same day in one section", () => {
    const s = groupByDay([c({ id: "a", created_at: now - 60 }), c({ id: "b", created_at: now - 30 })], now);
    expect(s).toHaveLength(1);
    expect(s[0].comments.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("splits across a day boundary and keeps the order", () => {
    const s = groupByDay([c({ id: "old", created_at: now - DAY }), c({ id: "new", created_at: now })], now);
    expect(s.map((x) => x.label)).toEqual(["Yesterday", "Today"]);
  });

  it("returns nothing for an empty thread", () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe("quotedParent", () => {
  it("names the parent author and truncates a long body", () => {
    const parent = c({ id: "p", user_name: "Grace", body: "x".repeat(200) });
    const reply = c({ id: "r", parent_id: "p" });
    const q = quotedParent(reply, [parent, reply]);
    expect(q?.author).toBe("Grace");
    expect(q?.excerpt.startsWith("x".repeat(QUOTE_LENGTH))).toBe(true);
    expect(q?.excerpt.length).toBeLessThanOrEqual(QUOTE_LENGTH + 1);
  });

  it("is null for a top-level comment", () => {
    expect(quotedParent(c(), [c()])).toBeNull();
  });

  it("is null when the parent is gone, rather than throwing", () => {
    // A client can hold a reply whose parent was just deleted. The screen must
    // still draw the reply.
    const orphan = c({ id: "r", parent_id: "missing" });
    expect(quotedParent(orphan, [orphan])).toBeNull();
  });
});

describe("canEdit", () => {
  it("allows the author only", () => {
    expect(canEdit(c({ user_id: "u1" }), "u1")).toBe(true);
    expect(canEdit(c({ user_id: "u2" }), "u1")).toBe(false);
  });

  it("is false when we do not know who we are", () => {
    expect(canEdit(c({ user_id: "u1" }), null)).toBe(false);
  });
});

describe("canDelete", () => {
  it("allows the author whatever their role", () => {
    expect(canDelete(c({ user_id: "u1" }), "u1", "member")).toBe(true);
  });

  it("allows an owner or admin on someone else's comment", () => {
    expect(canDelete(c({ user_id: "u2" }), "u1", "owner")).toBe(true);
    expect(canDelete(c({ user_id: "u2" }), "u1", "admin")).toBe(true);
  });

  it("refuses a member on someone else's comment", () => {
    expect(canDelete(c({ user_id: "u2" }), "u1", "member")).toBe(false);
  });

  it("matches a role name regardless of case", () => {
    // /api/me/permissions returns role_name from the roles table; the API's own
    // check is lowercase. Do not let capitalisation decide who can moderate.
    expect(canDelete(c({ user_id: "u2" }), "u1", "Owner")).toBe(true);
  });
});

describe("isRunStart", () => {
  const base = c({ id: "a", user_id: "u1", created_at: 1000 });

  it("starts a run when there is nothing before it", () => {
    expect(isRunStart(base, undefined)).toBe(true);
  });

  it("starts a run when the author changes", () => {
    expect(isRunStart(c({ user_id: "u2", created_at: 1010 }), base)).toBe(true);
  });

  it("continues a run for the same author moments later", () => {
    expect(isRunStart(c({ user_id: "u1", created_at: 1010 }), base)).toBe(false);
  });

  it("starts a new run after a long gap from the same author", () => {
    expect(isRunStart(c({ user_id: "u1", created_at: 1000 + 3600 }), base)).toBe(true);
  });
});
