import { roleLabel, workspaceIconUrl, timeAgo } from "./workspace-format";
import { API_BASE_URL } from "@/api";

describe("roleLabel", () => {
  it("maps role_owner to Owner (web compares against 'owner' and always shows Member)", () => {
    expect(roleLabel("role_owner")).toBe("Owner");
  });
  it("maps the other known roles", () => {
    expect(roleLabel("role_admin")).toBe("Admin");
    expect(roleLabel("role_member")).toBe("Member");
    expect(roleLabel("role_viewer")).toBe("Viewer");
  });
  it("calls an unknown/custom role a custom role, not a Member", () => {
    // Deliberately NOT "Member": a workspace-defined role has an id like
    // `role_custom_123`, and labelling it "Member" asserted a builtin role the
    // holder does not have - so a workspace running on custom roles showed
    // every member identically. The team screen resolves the real NAME from
    // /api/roles; this is the fallback for screens that only have the id.
    expect(roleLabel("role_custom_123")).toBe("Custom role");
  });
});

it("builds the workspace icon endpoint url", () => {
  expect(workspaceIconUrl("w1")).toBe(`${API_BASE_URL}/api/workspaces/w1/icon`);
});

describe("timeAgo", () => {
  const now = 1_700_000_000;
  it("formats recent times", () => {
    expect(timeAgo(now - 30, now)).toBe("just now");
    expect(timeAgo(now - 60 * 5, now)).toBe("5 minutes ago");
    expect(timeAgo(now - 3600 * 3, now)).toBe("3 hours ago");
  });
  it("formats days, months and years", () => {
    expect(timeAgo(now - 86400 * 2, now)).toBe("2 days ago");
    expect(timeAgo(now - 86400 * 60, now)).toBe("2 months ago");
    expect(timeAgo(now - 86400 * 400, now)).toBe("1 year ago");
  });
  it("singularises", () => {
    expect(timeAgo(now - 86400, now)).toBe("1 day ago");
  });
});
