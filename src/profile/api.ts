import { apiRequest, API_BASE_URL } from "@/api";
import { t } from "@/lib/i18n";
import type { PasskeyCreateRequest } from "react-native-passkey";
import type { PasskeyAttestationJson } from "@/auth/passkey";
import type { MeUser, EmailChangeResult, TwoFaStatus, TotpSetup, DeviceSession, PasskeysStatus } from "./types";

export async function getMe(): Promise<MeUser> {
  const res = await apiRequest<{ ok: true; user: MeUser }>("/api/me");
  return res.user;
}

export async function updateName(name: string): Promise<string> {
  const res = await apiRequest<{ ok: true; name: string }>("/api/me/name", {
    method: "PUT",
    body: { name },
  });
  return res.name;
}

/**
 * Start an email change. Requires the current password. The server no-ops when the
 * address is unchanged (returning no `pending` flag) - surfaced here as a distinct
 * result so callers can't mistakenly wait for a code that will never arrive.
 */
export async function requestEmailChange(email: string, currentPassword: string): Promise<EmailChangeResult> {
  const res = await apiRequest<{ ok: true; pending?: boolean; new_email?: string; email?: string }>(
    "/api/me/email",
    { method: "PUT", body: { email, current_password: currentPassword } },
  );
  if (res.pending) return { kind: "pending", newEmail: res.new_email ?? email };
  return { kind: "unchanged", email: res.email ?? email };
}

/** Confirm a pending email change with the 6-digit code; returns the new address. */
export async function confirmEmailChange(code: string): Promise<string> {
  const res = await apiRequest<{ ok: true; email: string }>("/api/me/email/confirm", {
    method: "POST",
    body: { code },
  });
  return res.email;
}

/**
 * The authenticated avatar endpoint. It streams bytes (no redirect), so an image
 * request carrying the Bearer header works. Responses are cached for an hour and the
 * url never changes, so pass `bust` after an upload or the old image sticks.
 */
export function avatarUrl(bust?: number): string {
  return `${API_BASE_URL}/api/me/avatar${bust ? `?t=${bust}` : ""}`;
}

/**
 * Upload a new avatar. `fileName` matters: the server derives the stored key's
 * extension from it (defaulting to png), so pass the real name.
 */
export async function uploadAvatar(uri: string, mimeType: string, fileName: string): Promise<string> {
  const form = new FormData();
  // RN's FormData takes this {uri, name, type} shape for file parts.
  form.append("avatar", { uri, name: fileName, type: mimeType } as unknown as Blob);
  const res = await apiRequest<{ ok: true; avatar_url: string }>("/api/me/avatar", {
    method: "POST",
    body: form,
  });
  return res.avatar_url;
}

export async function deleteAvatar(): Promise<void> {
  await apiRequest<{ ok: true }>("/api/me/avatar", { method: "DELETE" });
}

// ---------------------------------------------------------------- password & 2FA

/**
 * The password rules the server actually enforces (the shared validation policy,
 * which me/password.ts now calls directly). Length only: composition mandates
 * push people toward short mangled passwords and reject strong passphrases, so
 * the rule is 8 to 256 characters and nothing else. Keep this sentence true - a
 * client promising a rule the server does not enforce is how users hit a 400
 * for something they were never told, and vice versa.
 */
export const passwordRules = (): string => t("common.description.between8And256CharactersAMemorablePassphraseWorksWell");

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest<{ ok: true }>("/api/me/password", {
    method: "PUT",
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

export async function get2faStatus(): Promise<TwoFaStatus> {
  const res = await apiRequest<{ ok: true } & TwoFaStatus>("/api/me/2fa/status");
  return {
    method: res.method,
    totp_enabled: res.totp_enabled,
    recovery_codes_remaining: res.recovery_codes_remaining,
  };
}

export async function enableEmail2fa(): Promise<void> {
  await apiRequest<{ ok: true; method: string }>("/api/me/2fa/enable-email", { method: "POST" });
}

/** Stores a secret server-side but leaves TOTP disabled until verifyTotp succeeds. */
export async function setupTotp(): Promise<TotpSetup> {
  const res = await apiRequest<{ ok: true; secret: string; uri: string }>("/api/me/2fa/setup-totp", {
    method: "POST",
  });
  return { secret: res.secret, uri: res.uri };
}

/** Verifies the first code and enables TOTP; returns the one-time recovery codes. */
export async function verifyTotp(code: string): Promise<string[]> {
  const res = await apiRequest<{ ok: true; recovery_codes: string[] }>("/api/me/2fa/verify-totp", {
    method: "POST",
    body: { code },
  });
  return res.recovery_codes;
}

export async function disable2fa(password: string): Promise<void> {
  await apiRequest<{ ok: true }>("/api/me/2fa/disable", { method: "POST", body: { password } });
}

// ---------------------------------------------------------------------- sessions

/** Every signed-in device - browser sessions and mobile app tokens alike. */
export async function getSessions(): Promise<DeviceSession[]> {
  const res = await apiRequest<{ ok: true; sessions: DeviceSession[] }>("/api/me/sessions");
  return res.sessions;
}

/** Revoke one device. The server refuses the caller's own (that's a sign-out). */
export async function revokeSession(id: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/me/sessions/${id}`, { method: "DELETE" });
}

/** Revoke every other device, of both kinds. */
export async function revokeAllOtherSessions(): Promise<void> {
  await apiRequest<{ ok: true }>("/api/me/sessions", { method: "DELETE" });
}

export async function regenerateRecoveryCodes(password: string): Promise<string[]> {
  const res = await apiRequest<{ ok: true; recovery_codes: string[] }>("/api/me/2fa/recovery-codes", {
    method: "POST",
    body: { password },
  });
  return res.recovery_codes;
}

export async function getPasskeys(): Promise<PasskeysStatus> {
  const res = await apiRequest<{ ok: true } & PasskeysStatus>("/api/me/passkeys");
  return { passkeys: res.passkeys, proof: res.proof };
}

/** Email the code an account with no password confirms a new passkey with. */
export async function sendPasskeyCode(): Promise<void> {
  await apiRequest<{ ok: true }>("/api/me/passkeys/code", { method: "POST", body: {} });
}

export type PasskeyProof = { password: string } | { code: string };

/** Prove the owner, then get the options the native sheet needs. */
export async function passkeyOptions(proof: PasskeyProof): Promise<{ challenge_token: string; options: PasskeyCreateRequest }> {
  const res = await apiRequest<{ ok: true; challenge_token: string; options: PasskeyCreateRequest }>(
    "/api/me/passkeys/options",
    { method: "POST", body: proof },
  );
  return { challenge_token: res.challenge_token, options: res.options };
}

export async function savePasskey(challengeToken: string, response: PasskeyAttestationJson, name?: string): Promise<void> {
  await apiRequest<{ ok: true }>("/api/me/passkeys", {
    method: "POST",
    body: { challenge_token: challengeToken, response, name },
  });
}

export async function removePasskey(id: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/me/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" });
}
