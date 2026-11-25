export type FamilyRole = "none" | "payer" | "member";
export type FamilyMemberView = {
  id: string; email: string; name: string | null;
  status: "invited" | "active"; joined_at: number | null; expires_at: number | null;
  over_free?: boolean;
  /** Their active reservation in bytes, or null (always null for invitations and an unpaid pool). Older APIs omit it. */
  reserved_bytes?: number | null;
  /** Active members only: what they take from the pool, as the upload gates count it. */
  used_bytes?: number;
  /** Payer view, active members only: the most that can be reserved for them now (0 when the payer's plan lapsed). */
  max_reservable_bytes?: number;
  /** The member's user id (their usage row's id), null for an invitation. Older APIs omit it. */
  user_id?: string | null;
};
export type FamilyUsageRow = {
  id: string; name: string; is_you: boolean; is_payer: boolean; used_bytes: number; used_label: string;
  /** Their active reservation in bytes, or null. Older APIs omit it. */
  reserved_bytes?: number | null;
};
export type FamilyView = {
  ok: true;
  role: FamilyRole;
  limit: number;
  included?: number;
  extra_places?: number;
  can_buy_places?: boolean;
  over_capacity?: boolean;
  eligible: boolean;
  ineligible_reason: "free_plan" | "is_member" | null;
  pool: {
    /** The payer's pool. */
    used_bytes: number; limit_bytes: number; used_label: string; limit_label: string;
    /** Sum of active reservations. Older APIs omit it. */
    reserved_bytes?: number;
    /** Reserved but not yet used. */
    held_bytes?: number;
    /** What people without a reservation can still use. */
    free_bytes?: number;
  };
  /** Active reservations add up to more than the pool (the plan shrank). Older APIs omit it. */
  reservations_exceed_pool?: boolean;
  plan: { id: string; name: string };
  payer: { name: string } | null;
  members: FamilyMemberView[] | null;
  usage?: FamilyUsageRow[];
  own_used_bytes?: number;
  own_used_label?: string;
  /** Member view only: the caller's own active reservation, or null. */
  own_reserved_bytes?: number | null;
};
