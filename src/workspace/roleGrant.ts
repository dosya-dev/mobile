/**
 * Which roles the signed-in member may hand to someone else.
 *
 * A mirror of the grant rule in apps/api/src/lib/role-rank.ts
 * (permissionsBeyondGrantor), kept in the same shape so the two cannot drift
 * apart quietly. The server is still the authority: it answers 403 to any
 * grant outside this rule. This exists so the invite chips and the member role
 * sheet stop offering roles whose only possible outcome is that 403.
 *
 * The rule is one sentence: a role may be granted if and only if it is not
 * role_owner AND every permission it grants is one the caller holds.
 *  - Nobody grants owner; ownership is transferred, never assigned.
 *  - No rank ladder. manage_roles is a permission like any other, not an
 *    escalation.
 *  - The built-in tiers are not exempt. /api/roles serves the full permission
 *    map for Admin, Member and Viewer as it does for a custom role, so the
 *    same subset test covers all of them.
 *  - The caller's own role id plays no part, which is why canGrantRole no
 *    longer takes it.
 */
import type { RoleInfo } from "./api";

const OWNER_ROLE_ID = "role_owner";

/**
 * The requested grants the grantor does not hold, in request order. Empty
 * means the request is within the ceiling. A requested `false` is never an
 * escalation, and an absent grantor key reads as `false`.
 */
export function permissionsBeyondGrantor(
  grantorPerms: Record<string, boolean>,
  requested: Record<string, boolean>,
): string[] {
  const beyond: string[] = [];
  for (const [key, granted] of Object.entries(requested)) {
    if (granted === true && grantorPerms[key] !== true) beyond.push(key);
  }
  return beyond;
}

/** Any role shape carrying an id and a permission map, so a full RoleInfo fits too. */
export type GrantTarget = Pick<RoleInfo, "id" | "permissions"> & Partial<RoleInfo>;

/**
 * Whether a member holding `myPerms` may assign `target`. A target whose
 * permission map is missing is not refused here: there is nothing to compare
 * against, so the list keeps it and the server gives the answer.
 */
export function canGrantRole(myPerms: Record<string, boolean>, target: GrantTarget): boolean {
  if (target.id === OWNER_ROLE_ID) return false;
  return permissionsBeyondGrantor(myPerms, target.permissions ?? {}).length === 0;
}
