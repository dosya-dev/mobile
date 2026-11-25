import { canGrantRole, permissionsBeyondGrantor } from "./roleGrant";

/**
 * The registry as the API serves it: 36 keys. /api/roles carries the whole
 * map for every role, built-in tiers included, so the subset rule applies to
 * Admin and Viewer exactly as it does to a custom role.
 */
const REGISTRY = [
  "upload_files", "download_files", "delete_own_files", "delete_any_file", "rename_files",
  "create_folders", "rename_folders", "create_share_links", "view_own_shares", "view_all_shares",
  "invite_members", "view_team_members", "manage_roles", "change_workspace_name", "change_workspace_icon",
  "change_max_file_size", "change_storage_per_member", "change_total_storage_cap",
  "change_max_concurrent_uploads", "change_allowed_file_types", "change_blocked_file_types",
  "change_duplicate_scan", "change_ai_search", "manage_settings", "view_activity", "lock_files", "hide_files",
  "access_dashboard", "access_files", "access_upload", "access_shared", "access_team",
  "access_settings", "access_webdav", "access_s3", "access_sftp",
] as const;

function only(...granted: string[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const key of REGISTRY) map[key] = granted.includes(key);
  return map;
}

/** The seeded owner: every key true. */
const OWNER_PERMS = only(...REGISTRY);
/** The seeded admin: 34 true, lock_files and hide_files false. */
const ADMIN_PERMS = only(...REGISTRY.filter((k) => k !== "lock_files" && k !== "hide_files"));
const MEMBER_PERMS = only(
  "upload_files", "download_files", "delete_own_files", "rename_files", "create_folders",
  "rename_folders", "create_share_links", "view_own_shares", "view_team_members",
  "access_dashboard", "access_files", "access_upload", "access_shared", "access_team",
);
const VIEWER_PERMS = only("download_files", "view_own_shares", "access_dashboard", "access_files", "access_shared");

const owner = { id: "role_owner", name: "Owner", is_builtin: true, permissions: OWNER_PERMS };
const admin = { id: "role_admin", name: "Admin", is_builtin: true, permissions: ADMIN_PERMS };
const member = { id: "role_member", name: "Member", is_builtin: true, permissions: MEMBER_PERMS };
const viewer = { id: "role_viewer", name: "Viewer", is_builtin: true, permissions: VIEWER_PERMS };

describe("permissionsBeyondGrantor", () => {
  it("names the requested grants the grantor lacks, in request order", () => {
    expect(permissionsBeyondGrantor({ upload_files: true }, { lock_files: true, upload_files: true, hide_files: true }))
      .toEqual(["lock_files", "hide_files"]);
  });

  it("treats a requested false and an absent grantor key as no escalation", () => {
    expect(permissionsBeyondGrantor({}, { lock_files: false })).toEqual([]);
    expect(permissionsBeyondGrantor({ upload_files: true }, { upload_files: true })).toEqual([]);
  });
});

describe("canGrantRole", () => {
  it("never grants owner, whoever asks", () => {
    expect(canGrantRole(OWNER_PERMS, owner)).toBe(false);
    expect(canGrantRole(ADMIN_PERMS, owner)).toBe(false);
  });

  it("lets an admin grant admin, member and viewer", () => {
    for (const t of [admin, member, viewer]) expect(canGrantRole(ADMIN_PERMS, t)).toBe(true);
  });

  it("refuses an admin a custom target that carries lock_files", () => {
    const locker = { id: "role_c9", name: "Locker", is_custom: true, permissions: { upload_files: true, lock_files: true } };
    expect(canGrantRole(ADMIN_PERMS, locker)).toBe(false);
    expect(canGrantRole({ ...ADMIN_PERMS, lock_files: true }, locker)).toBe(true);
  });

  it("refuses a team-manager custom role the viewer tier, which holds download_files", () => {
    // The behaviour change from the rank rule: built-in tiers are not exempt
    // from the subset test, and manage_roles no longer lifts anyone.
    const manager = only("invite_members", "manage_roles", "view_team_members", "access_team");
    expect(canGrantRole(manager, viewer)).toBe(false);
    expect(canGrantRole(manager, member)).toBe(false);
    expect(canGrantRole(manager, admin)).toBe(false);
    expect(canGrantRole(manager, { id: "role_c2", name: "Other", is_custom: true, permissions: { download_files: true } })).toBe(false);
    expect(canGrantRole(manager, { id: "role_c3", name: "Greeter", is_custom: true, permissions: { invite_members: true, access_team: true } })).toBe(true);
  });

  it("lets an owner holding every permission grant anything but owner", () => {
    for (const t of [admin, member, viewer]) expect(canGrantRole(OWNER_PERMS, t)).toBe(true);
    const locker = { id: "role_c9", name: "Locker", is_custom: true, permissions: { lock_files: true, hide_files: true } };
    expect(canGrantRole(OWNER_PERMS, locker)).toBe(true);
  });

  it("allows a custom target within the caller's permissions", () => {
    const uploader = { id: "role_c8", name: "Uploader", is_custom: true, permissions: { upload_files: true, lock_files: false } };
    expect(canGrantRole(ADMIN_PERMS, uploader)).toBe(true);
    expect(canGrantRole(only("upload_files"), uploader)).toBe(true);
  });
});
