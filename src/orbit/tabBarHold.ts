import { useEffect } from "react";
import { create } from "zustand";

/**
 * Screens that need the whole height - the Vault's first-run walkthrough -
 * take the tab bar away while they are up.
 *
 * The file viewer does the same through `tabBarStyle`, but that is keyed off
 * the focused ROUTE, set from the tabs layout. The walkthrough is not a route
 * of its own: it is a state of the Vault tab's root screen, which only knows
 * it once the identity check comes back. So it holds the bar here instead,
 * and OrbitTabBar steps aside while any hold is out.
 *
 * Holds are named so two screens cannot release each other's.
 */
export const useTabBarHolds = create<{ holds: string[] }>(() => ({ holds: [] }));

export function holdTabBar(key: string): void {
  useTabBarHolds.setState((s) => (s.holds.includes(key) ? s : { holds: [...s.holds, key] }));
}

export function releaseTabBar(key: string): void {
  useTabBarHolds.setState((s) => (s.holds.includes(key) ? { holds: s.holds.filter((h) => h !== key) } : s));
}

/** Holds the bar while `active`, and always lets go on unmount. */
export function useTabBarHold(key: string, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    holdTabBar(key);
    return () => releaseTabBar(key);
  }, [key, active]);
}
