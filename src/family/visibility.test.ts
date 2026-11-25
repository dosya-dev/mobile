import { showsFamilyEntry } from "./visibility";

const base = { ok: true, limit: 5, pool: { used_bytes: 0, limit_bytes: 1, used_label: "0 B", limit_label: "5 GB" }, plan: { id: "free", name: "Free" }, payer: null } as const;

it("hides for a free user with nobody and for no data", () => {
  expect(showsFamilyEntry(undefined)).toBe(false);
  expect(showsFamilyEntry({ ...base, role: "none", eligible: false, ineligible_reason: "free_plan", members: [] } as any)).toBe(false);
});

it("shows for an eligible payer, a member, and a lapsed payer who still has people", () => {
  expect(showsFamilyEntry({ ...base, role: "none", eligible: true, ineligible_reason: null, members: [] } as any)).toBe(true);
  expect(showsFamilyEntry({ ...base, role: "member", eligible: false, ineligible_reason: "is_member", members: null } as any)).toBe(true);
  expect(showsFamilyEntry({ ...base, role: "none", eligible: false, ineligible_reason: "free_plan", members: [{ id: "x" }] } as any)).toBe(true);
});
