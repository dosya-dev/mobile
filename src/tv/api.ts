import { apiRequest } from "@/api";

/** GET /api/auth/tv/lookup (docs/TV-API-CONTRACT.md §1). */
export interface TvLookup {
  user_code: string;
  device_type: string;
  device_model: string | null;
  location: string | null;
  expires_at: number;
}

export type TvDecision = "allow" | "deny";

/** Longest name the API stores for the TV's session (contract: trimmed, at most 40 chars). */
export const TV_NAME_MAX = 40;

/** What a signed-in phone may learn about a waiting TV. 404 when the code is unknown, expired or used. */
export function lookupTvCode(code: string): Promise<TvLookup> {
  return apiRequest<TvLookup>(`/api/auth/tv/lookup?code=${encodeURIComponent(code)}`);
}

/**
 * Allow or cancel the TV's sign-in. 404 when the code is gone, 409 when it was
 * already allowed or cancelled (one conditional update on the server).
 * `deviceName` is what Settings > Sessions will call the TV.
 */
export function decideTv(code: string, decision: TvDecision, deviceName?: string): Promise<{ ok: boolean }> {
  const body: { user_code: string; decision: TvDecision; device_name?: string } = { user_code: code, decision };
  const name = deviceName?.trim().slice(0, TV_NAME_MAX);
  if (decision === "allow" && name) body.device_name = name;
  return apiRequest<{ ok: boolean }>("/api/auth/tv/approve", { method: "POST", body });
}
