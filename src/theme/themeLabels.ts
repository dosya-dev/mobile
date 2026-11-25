import type { MessageKey } from "@/i18n/keys";
import type { SwatchName } from "./palette";
import type { ThemeId } from "./tokens";

/**
 * Keys, not text, for the names in the generated THEME_META and SWATCHES
 * tables (src/theme/tokens.ts and palette.ts are generated and keep their
 * English labels). Screens read `t(THEME_LABEL_KEYS[id])` at render so a
 * language switch reaches them.
 */
export const THEME_LABEL_KEYS: Record<ThemeId, MessageKey> = {
  default: "common.label.default",
  mono: "common.label.mono",
  claude: "common.label.claude",
  amber: "common.label.amber",
  ocean: "common.label.ocean",
  bubblegum: "common.label.bubblegum",
  vercel: "common.label.vercel",
  "neo-brutal": "common.label.neoBrutalism",
};

export const SWATCH_LABEL_KEYS: Record<SwatchName, MessageKey> = {
  green: "common.label.green",
  teal: "common.label.teal",
  blue: "common.label.blue",
  violet: "common.label.violet",
  pink: "common.label.pink",
  orange: "common.label.orange",
  graphite: "common.label.graphite",
};
