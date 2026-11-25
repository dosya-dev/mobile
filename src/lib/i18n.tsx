import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { LOCALES, isLocale, localeDir, type Locale } from "@/i18n/locales";
import { parseIcu, type IcuNode } from "@/i18n/icu";
import { makeT, type Messages, type T } from "@/i18n/translator";
import { layoutIsRtl, reloadForDirection, syncNativeDirection } from "@/lib/direction";
import { BIDI_CONTROLS, RLM, rtlBase } from "@/lib/text-direction";
import { LOADERS } from "@/i18n/loaders";
import en from "@/i18n/messages/en.json";
import { deviceLanguageTags, matchDeviceLocale } from "@/lib/device-locale";
import { readLocalePreference, writeLocalePreference, type LocalePreference } from "@/lib/locale-store";

/**
 * The app's UI language.
 *
 * One module-level store holds the current locale and its translator. React
 * reads it through useT()/useLocale() (useSyncExternalStore, so every consumer
 * re-renders in place on a switch, modals included); plain modules use the
 * exported `t`, which always translates with the current locale, and
 * onLocaleChange() when they cache text.
 *
 * Metro bundles every language; LOADERS only builds the chosen one's object. A
 * language that fails to load leaves the app in English. Code that runs without
 * the React tree (the backup task, the playback service, CarPlay) calls
 * ensureI18n() first, because nothing else has booted the store there.
 */

const english: Messages = en;

/** First strong isolate and pop directional isolate: keep a substituted value's own direction. */
const FSI = "\u2068";
const PDI = "\u2069";

/** Removes every Unicode bidi control: marks, embeddings, overrides and isolates. Run at every data sink. */
export function stripBidi(s: string): string {
  return s.replace(BIDI_CONTROLS, "");
}

/**
 * Wraps user content that a screen places inside a translated sentence by hand
 * (its own Text span, not a t() value) in an isolate, as t() does for its
 * values, in a right-to-left language only. Display only: strip it at sinks.
 */
export function isolateInRtl(s: string): string {
  return s !== "" && localeDir(currentLocale()) === "rtl" ? FSI + stripBidi(s) + PDI : s;
}

/**
 * A line a screen composes itself (not one t() message), such as "193 B · 22
 * أكتوبر" or a name followed by a time: in a right-to-left language it gets a
 * right-to-left base (a leading RLM) when its first strong letter is not RTL,
 * as t() output does. Each " · " separator also gets an RLM on both sides:
 * without them a number after a Latin part ("193 B · 22 أكتوبر") joins that
 * part as one left-to-right run (seen on device as "193 22 · B أكتوبر").
 * Left-to-right languages get the string back unchanged. Display only: strip
 * it at sinks.
 */
export function rtlLine(s: string): string {
  return localeDir(currentLocale()) === "rtl" ? rtlBase(s.replace(/ · /g, `${RLM} · ${RLM}`)) : s;
}

/**
 * The names a message substitutes as plain text ({name}), which never steer a
 * select or plural. A name that picks a branch anywhere in the message is left
 * out: its value must reach the selector exactly as given.
 */
function simpleArgs(nodes: IcuNode[]): Set<string> {
  const plain = new Set<string>();
  const choosers = new Set<string>();
  const walk = (list: IcuNode[]) => {
    for (const n of list) {
      if (typeof n === "string" || n.type === "pound") continue;
      if (n.type === "arg") plain.add(n.name);
      else {
        choosers.add(n.name);
        for (const branch of Object.values(n.options)) walk(branch);
      }
    }
  };
  walk(nodes);
  for (const name of choosers) plain.delete(name);
  return plain;
}

/** Parses `src`, or undefined when it is missing or broken (makeT then falls back). */
const tryParse = (src: string | undefined): IcuNode[] | undefined => {
  if (src === undefined) return undefined;
  try {
    return parseIcu(src);
  } catch {
    return undefined;
  }
};

/**
 * In a right-to-left language a Latin file name or an English server message
 * dropped into a sentence would reorder its punctuation. Wrapping each plain
 * string argument in an isolate keeps it intact. Values that choose a select or
 * plural branch are passed through untouched (an isolated "true" would match no
 * branch), numbers are left alone, and left-to-right languages are untouched.
 */
function buildT(locale: Locale, messages: Messages): T {
  const base = makeT(locale, messages, english);
  if (localeDir(locale) !== "rtl") return base;
  // Parsed once per key, from the message makeT renders: the translation, or
  // English when the translation is missing or broken.
  const plainArgs = new Map<string, Set<string>>();
  const plainFor = (key: string): Set<string> => {
    let names = plainArgs.get(key);
    if (!names) {
      const nodes = tryParse(messages[key]) ?? tryParse(english[key]);
      names = nodes ? simpleArgs(nodes) : new Set();
      plainArgs.set(key, names);
    }
    return names;
  };
  // Every message also gets a right-to-left base when it would otherwise open
  // as a left-to-right paragraph ("Wi-Fi فقط", "{used} من {total}"): see rtlBase.
  return (key, values) => {
    if (!values) return rtlBase(base(key, values));
    const plain = plainFor(key);
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(values)) {
      out[k] = typeof v === "string" && v !== "" && plain.has(k) ? FSI + stripBidi(v) + PDI : v;
    }
    return rtlBase(base(key, out));
  };
}

/** The messages for `locale`: English is already here, the rest come from LOADERS. */
export async function loadMessages(locale: Locale): Promise<Messages> {
  if (locale === "en") return english;
  return (await LOADERS[locale]()).default;
}

/** The language a preference resolves to right now. Never throws. */
function resolve(preference: LocalePreference): Locale {
  if (preference !== "device") return preference;
  try {
    return matchDeviceLocale(deviceLanguageTags(), LOCALES);
  } catch {
    return "en";
  }
}

/** The messages for `locale`; English (and English as the locale) if they cannot load. */
async function loadOrEnglish(locale: Locale): Promise<{ locale: Locale; messages: Messages }> {
  try {
    return { locale, messages: await loadMessages(locale) };
  } catch (err) {
    console.error("[i18n] could not load", locale, "- using English:", err);
    return { locale: "en", messages: english };
  }
}

export interface BootResult {
  locale: Locale;
  preference: LocalePreference;
  messages: Messages;
}

interface Snapshot {
  locale: Locale;
  preference: LocalePreference;
  t: T;
  /** The language's messages, for the strict matcher in lib/external-text.ts. */
  messages: Messages;
}

let snapshot: Snapshot = { locale: "en", preference: "device", t: makeT("en", english, english), messages: english };
// True once anything (the provider or ensureI18n) has set the starting language.
let booted = false;
let ensurePromise: Promise<void> | null = null;
const subscribers = new Set<() => void>();
const listeners = new Set<(l: Locale) => void>();
// Bumped by every switch request, so a slow load never lands after a newer one.
let generation = 0;
let pending: LocalePreference | null = null;

/** Replaces the snapshot without telling anyone. Returns whether the locale changed. */
function setSnapshot(locale: Locale, messages: Messages, preference: LocalePreference): boolean {
  const changed = locale !== snapshot.locale;
  snapshot = { locale, preference, t: buildT(locale, messages), messages };
  booted = true;
  return changed;
}

function announce(locale: Locale, changed: boolean): void {
  for (const fn of subscribers) fn();
  if (!changed) return;
  for (const fn of listeners) {
    try {
      fn(locale);
    } catch (err) {
      console.error("[i18n] locale listener failed:", err);
    }
  }
}

function activate(locale: Locale, messages: Messages, preference: LocalePreference): void {
  announce(locale, setSnapshot(locale, messages, preference));
}

const subscribe = (fn: () => void): (() => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};
const getSnapshot = (): Snapshot => snapshot;

/** Translates with whatever locale is current at call time. */
export const t: T = (key, values) => snapshot.t(key, values);

/** The current locale, for code outside React. */
export const currentLocale = (): Locale => snapshot.locale;

/** The current language's messages (the object changes on a switch). */
export const currentMessages = (): Messages => snapshot.messages;

/** Called after each switch of language. Returns the unsubscribe. */
export function onLocaleChange(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Reads the stored choice and loads the starting language. Never rejects: an
 * unreadable choice means "device", an unreadable device language means English.
 * The root layout awaits this before its first real render so a non-English
 * start never shows an English frame.
 */
export async function bootI18n(): Promise<BootResult> {
  let preference: LocalePreference = "device";
  try {
    preference = await readLocalePreference();
  } catch {
    /* readLocalePreference does not throw; belt and braces for a mocked store */
  }
  const { locale, messages } = await loadOrEnglish(resolve(preference));
  return { locale, preference, messages };
}

/**
 * For code that runs without the React tree: boots the store once (the
 * keychain is read once however often this is called). Idempotent, never
 * rejects, and a no-op after the provider has booted it.
 */
export function ensureI18n(): Promise<void> {
  if (booted) return Promise.resolve();
  ensurePromise ??= bootI18n()
    .then((b) => {
      // A provider that mounted while we were reading wins.
      if (!booted) {
        generation++;
        activate(b.locale, b.messages, b.preference);
      }
    })
    .catch(() => {});
  return ensurePromise;
}

/** Loads `locale` and shows it, unless a newer request came in meanwhile. */
async function switchTo(locale: Locale, preference: LocalePreference, mine: number): Promise<void> {
  const messages = await loadMessages(locale);
  if (mine === generation) activate(locale, messages, preference);
}

/**
 * Applies a choice: "device" follows the phone, otherwise one language. The old
 * language stays on screen until the new one has loaded; a failed load keeps the
 * old language and stores nothing. The choice is remembered on this device only.
 */
async function setPreference(preference: LocalePreference): Promise<void> {
  if (preference !== "device" && !isLocale(preference)) return;
  if (preference === (pending ?? snapshot.preference)) return;
  const mine = ++generation;
  pending = preference;
  try {
    await switchTo(resolve(preference), preference, mine);
    if (mine === generation) await writeLocalePreference(preference);
  } catch (err) {
    // The old language stays on screen and nothing is stored; callers need no catch.
    console.error("[i18n] could not switch to", preference, err);
  } finally {
    if (mine === generation) pending = null;
  }
}

export type DirectionRequest = { kind: "applied" } | { kind: "restart"; locale: Locale } | { kind: "unchanged" };

/**
 * The entry point for a language pick. Within the layout's direction it is
 * today's setPreference (instant). Into the other direction nothing is applied
 * or stored: the caller confirms with the user, then calls confirmDirectionSwitch.
 */
export async function requestPreference(preference: LocalePreference): Promise<DirectionRequest> {
  if (preference !== "device" && !isLocale(preference)) return { kind: "unchanged" };
  if (preference === (pending ?? snapshot.preference)) return { kind: "unchanged" };
  const target = resolve(preference);
  if ((localeDir(target) === "rtl") !== layoutIsRtl()) return { kind: "restart", locale: target };
  await setPreference(preference);
  return { kind: "applied" };
}

/**
 * Stores the choice, sets the native flags and restarts into the other
 * direction. When the restart is refused or fails the language is applied in
 * place instead (the one logged exception to the invariant).
 */
export async function confirmDirectionSwitch(preference: LocalePreference): Promise<"reloading" | "applied-in-place"> {
  if (preference !== "device" && !isLocale(preference)) return "applied-in-place";
  const rtl = localeDir(resolve(preference)) === "rtl";
  await writeLocalePreference(preference);
  syncNativeDirection(rtl);
  const result = await reloadForDirection("direction-switch", rtl);
  if (result === "reloading") return "reloading";
  console.error("[i18n] direction reload", result, "- applying", preference, "in place");
  await setPreference(preference);
  return "applied-in-place";
}

/**
 * While the choice is "device": picks up a language change made in the phone's
 * settings. A change to the other layout direction waits for the next cold start.
 */
function followDevice(): void {
  if ((pending ?? snapshot.preference) !== "device") return;
  const locale = resolve("device");
  if ((localeDir(locale) === "rtl") !== layoutIsRtl()) return;
  if (locale === snapshot.locale && pending === null) return;
  const mine = ++generation;
  pending = "device";
  switchTo(locale, "device", mine)
    .catch((err) => console.error("[i18n] could not load", locale, err))
    .finally(() => {
      if (mine === generation) pending = null;
    });
}

/**
 * Sets the starting language (the bootI18n result) and, while the choice is
 * "device", re-resolves it whenever the app returns to the foreground.
 */
export function I18nProvider({ initial, children }: { initial: BootResult | null; children: ReactNode }) {
  const primed = useRef<{ locale: Locale; changed: boolean } | null>(null);
  // `initial` is null while the root layout is still booting; the first non-null
  // value is applied during render, before any child reads the language. Nobody
  // is told from inside render (that would set state in another component
  // mid-render); components already mounted read the new snapshot as they
  // render, and subscribers and onLocaleChange listeners hear about it in the
  // effect below.
  if (primed.current === null && initial) {
    generation++;
    primed.current = {
      locale: initial.locale,
      changed: setSnapshot(initial.locale, initial.messages, initial.preference),
    };
  }
  const announced = primed.current;
  useEffect(() => {
    if (announced) announce(announced.locale, announced.changed);
  }, [announced]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") followDevice();
    });
    return () => sub.remove();
  }, []);
  return <>{children}</>;
}

/** t() for the current locale; the component re-renders when it changes. */
export function useT(): T {
  return useSyncExternalStore(subscribe, getSnapshot).t;
}

export function useLocale(): {
  locale: Locale;
  preference: LocalePreference;
  setPreference(p: LocalePreference): Promise<void>;
} {
  const { locale, preference } = useSyncExternalStore(subscribe, getSnapshot);
  return { locale, preference, setPreference };
}

/** Test seam: back to the untouched English start, as at a cold launch. Not for app code. */
export function __resetI18nForTests(): void {
  snapshot = { locale: "en", preference: "device", t: makeT("en", english, english), messages: english };
  booted = false;
  ensurePromise = null;
  generation = 0;
  pending = null;
  subscribers.clear();
  listeners.clear();
}
