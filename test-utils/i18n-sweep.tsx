/**
 * Leftover-English sweep for component tests (React Native).
 *
 * Renders a component under I18nProvider in a target language, reads every
 * visible text and the attributes users hear or see (accessibilityLabel,
 * accessibilityHint, placeholder) from the rendered tree, plus header titles
 * (through routerMockWithTitles) and Alert.alert calls (captureAlerts), and
 * returns the texts that are still English.
 *
 * "Still English" is decided by the strict text matcher (src/i18n/match.ts),
 * built from the mobile catalog's English messages and the target language's
 * messages: a text is leftover only when the matcher recognises it as the
 * English of a catalog key AND the language has different text for that key.
 * Text the catalog does not know (user data, server text, proper nouns) is
 * never reported. Later tasks extend this helper rather than writing another.
 *
 * Lives outside src/ so Metro never reaches it.
 */
import type { ReactElement, ReactNode } from "react";
import { Alert, StyleSheet } from "react-native";
import { render, screen, type RenderResult } from "@testing-library/react-native";
import { LOCALES, localeDir, type Locale } from "../src/i18n/locales";
import { createTextMatcher, type TextMatcher } from "../src/i18n/match";
import type { Messages } from "../src/i18n/translator";
import en from "../src/i18n/messages/en.json";
import { I18nProvider, loadMessages } from "../src/lib/i18n";
import { __setLayoutRtlForTests, layoutIsRtl } from "../src/lib/direction";
import { DIRECTIONAL_ICONS, Icon } from "../src/ui/Icon";

// react-test-renderer ships no types here; this is the part of its instance the helpers use.
export interface ReactTestInstance {
  type: unknown;
  props: Record<string, unknown>;
  parent: ReactTestInstance | null;
  findAll(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance[];
}

const ATTRIBUTES = ["accessibilityLabel", "accessibilityHint", "placeholder", "title", "alt"] as const;

interface Node {
  type?: string;
  props?: Record<string, unknown>;
  children?: (Node | string)[] | null;
}

const matchers = new Map<Locale, TextMatcher>();

function messagesFor(locale: Locale): Messages {
  if (locale === "en") return en as Messages;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(`../src/i18n/messages/${locale}.json`) as Messages;
}

/** A strict matcher over every catalog key for `locale`. */
function matcherFor(locale: Locale): TextMatcher {
  let m = matchers.get(locale);
  if (!m) {
    const english = en as Record<string, string>;
    const strings = Object.keys(english).map((key) => ({ key, source: english[key] }));
    m = createTextMatcher({ strings }, messagesFor(locale), locale, { strict: true });
    matchers.set(locale, m);
  }
  return m;
}

/** Every visible text and attribute value under `root` (default: the whole screen), trimmed, in tree order. */
export function collectTexts(root?: Node | Node[] | null): string[] {
  const tree = (root === undefined ? screen.toJSON() : root) as Node | Node[] | null;
  const out: string[] = [];
  const walk = (n: Node | string | null | undefined): void => {
    if (n === null || n === undefined) return;
    if (typeof n === "string") {
      const s = n.trim();
      if (s) out.push(s);
      return;
    }
    for (const attr of ATTRIBUTES) {
      const v = n.props?.[attr];
      if (typeof v === "string" && v.trim()) out.push(v.trim());
    }
    for (const c of n.children ?? []) walk(c);
  };
  if (Array.isArray(tree)) tree.forEach(walk);
  else walk(tree);
  return out;
}

/** The texts in `texts` that are English the language has a different text for. */
export function leftoverEnglish(texts: string[], locale: Locale, opts?: { allow?: string[] }): string[] {
  const allow = new Set(opts?.allow ?? []);
  const matcher = matcherFor(locale);
  const seen = new Set<string>();
  for (const text of texts) {
    if (allow.has(text)) continue;
    const translated = matcher.translate(text);
    if (translated !== null && translated !== text) seen.add(text);
  }
  return [...seen];
}

export interface CapturedAlerts {
  calls: { title: string; message?: string; buttons: string[] }[];
  /** Every title, message and button label of every Alert.alert call so far. */
  texts(): string[];
  restore(): void;
}

/** Records Alert.alert calls without showing anything. */
export function captureAlerts(): CapturedAlerts {
  const calls: CapturedAlerts["calls"] = [];
  const spy = jest.spyOn(Alert, "alert").mockImplementation((title, message, buttons) => {
    calls.push({ title, message, buttons: (buttons ?? []).map((b) => b.text ?? "") });
  });
  return {
    calls,
    texts: () => calls.flatMap((c) => [c.title, c.message ?? "", ...c.buttons]).filter(Boolean),
    restore: () => spy.mockRestore(),
  };
}

/**
 * Use as `jest.mock("expo-router", () => require("../test-utils/i18n-sweep").routerMockWithTitles())`.
 * Stack.Screen and Tabs.Screen render options.title / headerTitle / tabBarLabel as
 * text with testID "screen-title", so header titles and tab labels are visible to
 * the sweep. The router hooks are inert.
 */
export function routerMockWithTitles(): Record<string, unknown> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require("react");
  const { Text } = require("react-native");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const Screen = ({ options }: { options?: { title?: string; headerTitle?: unknown; tabBarLabel?: unknown } }) => {
    const label = [options?.title, options?.headerTitle, options?.tabBarLabel].find((v) => typeof v === "string");
    return label ? React.createElement(Text, { testID: "screen-title" }, label) : null;
  };
  const Group = ({ children }: { children?: ReactNode }) => React.createElement(React.Fragment, null, children);
  const Stack = Object.assign(Group, { Screen });
  const Tabs = Object.assign(Group, { Screen });
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
  return {
    Stack,
    Tabs,
    useRouter: () => router,
    useSegments: () => [],
    useLocalSearchParams: () => ({}),
    useRootNavigationState: () => ({ key: "root" }),
    useNavigationContainerRef: () => ({ current: null, isReady: () => true }),
    router,
  };
}

export interface Rendered extends RenderResult {
  /** Leftover English on the whole screen right now. */
  leftover(opts?: { allow?: string[] }): string[];
}

/** Renders `ui` under I18nProvider in `locale` (device preference unless stated), waiting for the language. */
export async function renderInLocale(ui: ReactElement, locale: Locale): Promise<Rendered> {
  if (!LOCALES.includes(locale)) throw new Error(`renderInLocale: ${locale} is not shipped`);
  const messages = await loadMessages(locale);
  // The native layout of a runtime started in this language (jest-setup resets it after each test).
  __setLayoutRtlForTests(localeDir(locale) === "rtl");
  const result = render(
    <I18nProvider initial={{ locale, preference: locale, messages }}>{ui}</I18nProvider>,
  );
  return { ...result, leftover: (opts) => leftoverEnglish(collectTexts(), locale, opts) };
}

function flatStyle(node: ReactTestInstance): Record<string, unknown> {
  return (StyleSheet.flatten(node.props?.style as never) ?? {}) as Record<string, unknown>;
}

/** Hosts under `tree` whose flattened style has `direction: "ltr"` (a media timeline, a document). */
export function ltrIslands(tree: ReactTestInstance): ReactTestInstance[] {
  return tree.findAll((n) => typeof n.type === "string" && flatStyle(n).direction === "ltr");
}

function flipped(node: ReactTestInstance): boolean {
  return node
    .findAll((n) => {
      const t = flatStyle(n).transform;
      return Array.isArray(t) && t.some((x) => (x as { scaleX?: number })?.scaleX === -1);
    })
    .length > 0;
}

/**
 * Names of the rendered `Icon`s under `tree` that point somewhere but are not
 * mirrored: directional name, no `scaleX: -1`, not inside an `ltr` island, no
 * `mirror={false}`. Always empty while the layout seam is left to right.
 */
export function unflippedIcons(tree: ReactTestInstance): string[] {
  if (!layoutIsRtl()) return [];
  const islands = new Set<ReactTestInstance>(ltrIslands(tree));
  const inIsland = (n: ReactTestInstance): boolean => {
    for (let p = n.parent; p; p = p.parent) if (islands.has(p)) return true;
    return false;
  };
  return tree
    .findAll((n) => n.type === Icon)
    .filter((n) => DIRECTIONAL_ICONS.has(n.props.name as never) && n.props.mirror !== false && !inIsland(n) && !flipped(n))
    .map((n) => String(n.props.name));
}
