import { apiRequest } from "@/api";
import type { FamilyView } from "./types";

export const getFamily = () => apiRequest<FamilyView>("/api/family");
export const inviteFamilyMember = (email: string) => apiRequest<{ ok: true }>("/api/family/invites", { method: "POST", body: { email } });
export const revokeFamilyInvite = (id: string) => apiRequest<{ ok: true }>(`/api/family/invites/${id}`, { method: "DELETE" });
export const removeFamilyMember = (id: string) => apiRequest<{ ok: true }>(`/api/family/members/${id}`, { method: "DELETE" });
export const leaveFamily = () => apiRequest<{ ok: true }>("/api/family/leave", { method: "POST" });
/** Hold `gb` whole GB for an active member (family_members.id); null removes the reservation. */
export const setFamilyReservation = (memberId: string, gb: number | null) =>
  apiRequest<{ ok: true }>(`/api/family/members/${memberId}/reservation`, { method: "PUT", body: { gb } });
