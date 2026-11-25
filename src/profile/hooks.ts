import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppearance } from "@/theme/themeStore";
import { getMe, get2faStatus, getSessions, getPasskeys } from "./api";

export const ME_KEY = ["me"] as const;
export const TWO_FA_KEY = ["2fa-status"] as const;
export const SESSIONS_KEY = ["sessions"] as const;
export const PASSKEYS_KEY = ["passkeys"] as const;

export function usePasskeys() {
  return useQuery({ queryKey: PASSKEYS_KEY, queryFn: getPasskeys, staleTime: 30_000 });
}

export function useSessions() {
  return useQuery({ queryKey: SESSIONS_KEY, queryFn: getSessions, staleTime: 15_000 });
}

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: getMe, staleTime: 60_000 });
}

/**
 * Adopt the server's saved appearance once /api/me resolves, so the theme follows the
 * user across devices (same rule as web: server wins over the local cache). The local
 * cache still drives first paint, so this only corrects a mismatch.
 */
export function useAppearanceSync(): void {
  const { data } = useMe();
  const applyFromServer = useAppearance((s) => s.applyFromServer);
  const uiTheme = data?.ui_theme;
  const uiMode = data?.ui_mode;
  useEffect(() => {
    if (uiTheme || uiMode) void applyFromServer(uiTheme, uiMode);
  }, [uiTheme, uiMode, applyFromServer]);
}

export function use2faStatus() {
  return useQuery({ queryKey: TWO_FA_KEY, queryFn: get2faStatus, staleTime: 30_000 });
}
