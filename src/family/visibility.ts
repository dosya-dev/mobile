import type { FamilyView } from "./types";

/**
 * Whether Profile offers a Family entry. A free user with nobody to manage
 * sees none: the only thing to tell them is "buy a plan", which the app
 * stores do not allow here.
 */
export function showsFamilyEntry(view: FamilyView | undefined | null): boolean {
  if (!view) return false;
  return view.role === "member" || view.role === "payer" || view.eligible || (view.members ?? []).length > 0;
}
