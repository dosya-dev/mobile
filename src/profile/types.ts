/**
 * The user as returned by GET /api/me - a richer projection than auth's `AuthUser`
 * (`buildMobileTokenResponseUser`, which login/2fa/verify return). Kept separate so
 * the auth store never claims fields those endpoints don't send.
 */
export interface MeUser {
  id: string;
  email: string;
  name: string;
  /** Server-computed (first+last initial, uppercased) - don't recompute. */
  initials: string;
  /** An R2 object key, NOT a url - treat as a presence flag for GET /api/me/avatar. */
  avatar_url: string | null;
  preferred_language: string;
  ui_theme: string;
  ui_mode: string;
  /** Unix seconds. */
  created_at: number;
  /** Unix seconds, or null when the address is unverified. */
  email_verified_at: number | null;
  /**
   * False for OAuth-created accounts: their stored password is a random value they were
   * never told, so every password-gated action (change password, disable 2FA, regenerate
   * recovery codes) fails permanently. Offer "Set a password" rather than a 401.
   */
  has_password: boolean;
  workspace_count: number;
  /** Server-decided feature flags (live chat: paid plan + rollout). Absent on older servers. */
  features?: { support_chat?: boolean };
  /**
   * The effective (lapse-aware) plan - the same answer the API's
   * isUserEffectivelyFree gives. For a family member it is the payer's plan.
   * Absent on older servers.
   */
  plan?: { id: string; name: string };
}

/** PUT /api/me/email either starts a pending change, or no-ops when the email is unchanged. */
export type EmailChangeResult =
  | { kind: "pending"; newEmail: string }
  | { kind: "unchanged"; email: string };

export interface TwoFaStatus {
  /** 'totp' | 'email' | null (disabled). */
  method: string | null;
  totp_enabled: boolean;
  recovery_codes_remaining: number;
}

export interface TotpSetup {
  secret: string;
  /** otpauth:// URI - render this as a QR locally; never send it to a third party. */
  uri: string;
}

/**
 * One signed-in device. The server returns browser sessions AND mobile app tokens in
 * this one shape, with `device`/`meta` pre-formatted - render those rather than
 * re-deriving from a user-agent (which the endpoint doesn't send).
 */
export interface DeviceSession {
  id: string;
  device: string;
  kind: "desktop" | "mobile" | "tablet" | "unknown";
  browser: string;
  meta: string;
  is_current: boolean;
  created_at: number;
}

/** One row of GET /api/me/passkeys. */
export interface Passkey {
  id: string;
  name: string;
  /** Non-zero when the passkey syncs through a cloud keychain. */
  backed_up: number;
  /** Unix seconds. */
  created_at: number;
  /** Unix seconds, or null before its first sign-in. */
  last_used_at: number | null;
}

export interface PasskeysStatus {
  passkeys: Passkey[];
  /** How this account proves itself before adding one: OAuth-created accounts have no password. */
  proof: "password" | "code";
}
