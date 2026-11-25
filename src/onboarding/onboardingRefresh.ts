import { create } from "zustand";

/**
 * OnboardingGate is mounted once, above the router's Stack (see app/_layout.tsx),
 * and its own effect only re-reads onboarding state when `accountId` changes. A
 * resume action elsewhere in the app - see the finish-setup row on the Backup tab -
 * clears `skippedAt` for the SAME account, so nothing about the gate's inputs
 * changes and a plain `router.replace` never reaches it (the gate sits above the
 * navigator, not inside it). Bumping this counter is the signal that does: the
 * gate includes `epoch` in its effect's dependency array purely to force a
 * re-read, without giving the epoch itself any meaning beyond "changed".
 */
interface OnboardingRefreshState {
  epoch: number;
  bump: () => void;
}

export const useOnboardingRefresh = create<OnboardingRefreshState>((set) => ({
  epoch: 0,
  bump: () => set((s) => ({ epoch: s.epoch + 1 })),
}));
