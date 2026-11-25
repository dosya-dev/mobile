/**
 * The first-load splash's stage machine. Pure on purpose: the splash's
 * truthfulness IS this function - the bar advances only when a real thing
 * finished loading, in a fixed order, and reports the EARLIEST unfinished
 * stage even when later signals happen to land first.
 */

import { t } from "@/lib/i18n";

export type FirstLoadPhase = "account" | "workspace" | "files" | "done";

export interface FirstLoadInputs {
  /** The signed-in profile is present (login response or fetchMe). */
  hasUser: boolean;
  /** Workspaces resolved and an active one chosen (or there are none to choose). */
  workspaceReady: boolean;
  /** The first page of the root listing landed (or there was nothing to fetch). */
  filesReady: boolean;
}

export interface FirstLoadStage {
  phase: FirstLoadPhase;
  /** Fixed design stops: 8 → 41 → 74 → 100. Monotonic by construction. */
  pct: number;
  label: string;
}

export function deriveFirstLoadStage(i: FirstLoadInputs): FirstLoadStage {
  if (!i.hasUser) return { phase: "account", pct: 8, label: t("files.label.signingYouIn") };
  if (!i.workspaceReady) return { phase: "workspace", pct: 41, label: t("files.label.openingYourWorkspace") };
  if (!i.filesReady) return { phase: "files", pct: 74, label: t("files.label.fetchingYourFiles") };
  return { phase: "done", pct: 100, label: "" };
}
