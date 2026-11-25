// Generates src/theme/tokens.ts from the web app's design tokens.
//
// Source of truth is apps/web/src/index.css - parsed, not hand-copied, so mobile can't
// drift from web. It defines 8 themes x light/dark as CSS custom properties in oklch;
// React Native needs concrete values, so we resolve the cascade and convert.
//
// Two subtleties this has to reproduce:
//
// 1. Theme blocks are PARTIAL overrides. `[data-theme="ocean"]` omits --destructive and
//    inherits it from `:root`. So a theme's real token set is a merge, not one block.
//
// 2. The cascade order is load-bearing. `.dark` and `[data-theme="x"]` have equal
//    specificity (0,1,0), so the later one in the file wins - and the theme blocks come
//    after `.dark`. `[data-theme="x"].dark` (0,2,0) beats both. Hence:
//        light(theme) = :root + [data-theme=theme]
//        dark(theme)  = :root + .dark + [data-theme=theme] + [data-theme=theme].dark
//    Note this means a var set in a theme's light block but NOT its dark block keeps its
//    light value in dark mode. That's what the browser does, so we match it rather than
//    "fix" it and diverge.
import { formatHex, converter } from "culori";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CSS = resolve(here, "../../web/src/index.css");
const THEMES_TS = resolve(here, "../../web/src/lib/themes.ts");
const OUT = resolve(here, "../src/theme/tokens.ts");
const GLOBAL_CSS = resolve(here, "../global.css");

const toRgb = converter("rgb");
const hex = (v) => formatHex(toRgb(v));
/** global.css stores channels ("243 250 255") so Tailwind can do rgb(var(--x) / <alpha>). */
const triple = (v) => {
  const c = toRgb(v);
  const ch = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
  return `${ch(c.r)} ${ch(c.g)} ${ch(c.b)}`;
};

// The tokens mobile uses: [mobileName, cssVarName, globalCssVarName]
const TOKENS = [
  ["background", "background", "bg"],
  ["foreground", "foreground", "fg"],
  ["card", "card", "card"],
  ["cardForeground", "card-foreground", "card-fg"],
  ["primary", "primary", "primary"],
  ["primaryForeground", "primary-foreground", "primary-fg"],
  ["secondary", "secondary", "secondary"],
  ["secondaryForeground", "secondary-foreground", "secondary-fg"],
  ["muted", "muted", "muted"],
  ["mutedForeground", "muted-foreground", "muted-fg"],
  ["accent", "accent", "accent"],
  ["accentForeground", "accent-foreground", "accent-fg"],
  ["destructive", "destructive", "destructive"],
  ["destructiveForeground", "destructive-foreground", "destructive-fg"],
  // The unresolved-state hue beside the error red: an important notification,
  // a payment that needs action. Web exposes it as text-warning; this is the
  // same value by the same route.
  ["warning", "warning", "warning"],
  ["warningForeground", "warning-foreground", "warning-fg"],
  ["border", "border", "border"],
  ["input", "input", "input"],
  ["ring", "ring", "ring"],
  // The brand green. It is NOT `primary`: under the shared system a primary button is
  // graphite, and green is reserved for the one conversion action and for confirmation
  // (a live dot, a finished backup, a passed check). Without these the app would have
  // no way to say "this worked" once primary stopped being green.
  ["brand", "brand", "brand"],
  ["brandHover", "brand-hover", "brand-hover"],
  ["brandForeground", "brand-foreground", "brand-fg"],
  ["brandText", "brand-text", "brand-text"],
];

/**
 * selector -> { cssVar: value }. Flat blocks only, which is all this file has.
 *
 * The capture between two blocks includes everything since the previous `}` - imports,
 * at-rules, comments - so the real selector is only the tail. Strip comments, then take
 * what follows the last `;`.
 */
function cleanSelector(raw) {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .pop()
    .trim()
    .replace(/\s+/g, " ");
}

function parseBlocks(css) {
  const blocks = new Map();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selector = cleanSelector(m[1]);
    const body = m[2];
    const vars = {};
    const vre = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let v;
    while ((v = vre.exec(body))) vars[v[1].trim()] = v[2].trim();
    if (Object.keys(vars).length) {
      // A selector can appear more than once; later declarations win.
      blocks.set(selector, { ...(blocks.get(selector) ?? {}), ...vars });
    }
  }
  return blocks;
}

const css = readFileSync(CSS, "utf8");
const blocks = parseBlocks(css);

const root = blocks.get(":root") ?? {};
const darkBlock = blocks.get(".dark") ?? {};

// Theme ids + labels come from web's registry so the two lists can't disagree.
const themesSrc = readFileSync(THEMES_TS, "utf8");
const metas = [...themesSrc.matchAll(/id:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'/g)].map((m) => ({
  id: m[1],
  label: m[2],
}));
if (metas.length === 0) throw new Error("no themes parsed from " + THEMES_TS);

function resolveTheme(id) {
  const light = id === "default" ? {} : blocks.get(`[data-theme="${id}"]`) ?? {};
  const dark = id === "default" ? darkBlock : blocks.get(`[data-theme="${id}"].dark`) ?? {};
  return {
    light: { ...root, ...light },
    dark: id === "default" ? { ...root, ...darkBlock } : { ...root, ...darkBlock, ...light, ...dark },
  };
}

const themes = {};
for (const { id } of metas) {
  const r = resolveTheme(id);
  const pick = (vars, fmt) =>
    Object.fromEntries(
      TOKENS.map(([name, cssVar]) => {
        const raw = vars[cssVar];
        if (!raw) throw new Error(`theme "${id}" is missing --${cssVar} even after cascade`);
        return [name, fmt(raw)];
      }),
    );
  themes[id] = {
    light: pick(r.light, hex),
    dark: pick(r.dark, hex),
    lightVars: Object.fromEntries(
      TOKENS.map(([, cssVar, gVar]) => [`--${gVar}`, triple(r.light[cssVar])]),
    ),
    darkVars: Object.fromEntries(
      TOKENS.map(([, cssVar, gVar]) => [`--${gVar}`, triple(r.dark[cssVar])]),
    ),
  };
}

const names = TOKENS.map(([n]) => `"${n}"`).join(" | ");
const ids = metas.map((m) => `"${m.id}"`).join(" | ");

const body = `// AUTO-GENERATED by scripts/gen-theme.mjs from apps/web/src/index.css - do not edit by hand.
// Run: node scripts/gen-theme.mjs
export type TokenName = ${names};
export type ThemeId = ${ids};
export type ThemeMode = "light" | "dark" | "system";

export const THEME_META: { id: ThemeId; label: string }[] = ${JSON.stringify(
  metas,
  null,
  2,
)};

export const THEME_IDS: ThemeId[] = ${JSON.stringify(metas.map((m) => m.id))};

/** Hex per theme/scheme - for imperative props (icon colours, tab bar). */
export const THEME_TOKENS: Record<ThemeId, { light: Record<TokenName, string>; dark: Record<TokenName, string> }> = ${JSON.stringify(
  Object.fromEntries(Object.entries(themes).map(([k, v]) => [k, { light: v.light, dark: v.dark }])),
  null,
  2,
)};

/** RGB channel triples matching global.css - fed to nativewind's vars() at runtime so
 *  every existing className (bg-card, text-foreground, ...) re-themes without edits. */
export const THEME_VARS: Record<ThemeId, { light: Record<string, string>; dark: Record<string, string> }> = ${JSON.stringify(
  Object.fromEntries(
    Object.entries(themes).map(([k, v]) => [k, { light: v.lightVars, dark: v.darkVars }]),
  ),
  null,
  2,
)};

// Back-compat: the default theme's tokens, as the single-theme build exported.
export const TOKENS_LIGHT: Record<TokenName, string> = THEME_TOKENS.default.light;
export const TOKENS_DARK: Record<TokenName, string> = THEME_TOKENS.default.dark;
`;

writeFileSync(OUT, body);

// global.css carries the same values as RGB channel triples, because nativewind's
// `rgb(var(--x) / <alpha-value>)` mapping needs channels rather than hex. It used to be
// hand-maintained beside a comment asking the next person to keep it in sync by hand;
// generating it removes the one step in this pipeline a human could forget.
const triples = (vars) =>
  Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");

writeFileSync(
  GLOBAL_CSS,
  `@tailwind base;
@tailwind components;
@tailwind utilities;

/* AUTO-GENERATED by scripts/gen-theme.mjs - do not edit.
   RGB channel triples for the DEFAULT theme, matching src/theme/tokens.ts. The other
   themes are applied at runtime through nativewind's vars() from THEME_VARS. */
:root {
${triples(themes.default.lightVars)}
}
.dark {
${triples(themes.default.darkVars)}
}
`,
);

console.log(`wrote ${OUT}: ${metas.length} themes x light/dark`);
console.log(`wrote ${GLOBAL_CSS}`);
