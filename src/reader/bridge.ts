import { t } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import type { TapBands } from "./chromeLayout";

/**
 * The origin the reader page is loaded under.
 *
 * Not cosmetic - it is what keeps the WebView's renderer alive. Handing
 * react-native-webview `source={{ html }}` with no baseUrl loads the page at
 * an OPAQUE origin (`location.origin === "null"`; Android reaches
 * loadDataWithBaseURL with a null base). foliate-js renders every section by
 * pointing a `sandbox="allow-same-origin allow-scripts"` iframe at a blob:
 * URL and then reading its contentDocument (see vendor/foliate-js/
 * paginator.js). From an opaque origin that combination kills the renderer
 * process outright - a native abort, not a catchable JS error - so NO book
 * ever rendered: the page died moments after the first section loaded and the
 * host sat on "Preparing book…" forever, because a dead renderer posts no
 * `relocate`.
 *
 * Giving the page a real origin fixes it. Verified by bisection: the same
 * page and the same book crash at `origin=null` and open fine over http.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve to a real host,
 * and the page's CSP is `default-src 'none'` (reader-page/index.html), so
 * this origin grants the page no reach it did not already have.
 */
export const READER_BASE_URL = "https://reader.invalid/";

/**
 * Whether the WebView may load `url`.
 *
 * The reader never needs to navigate: the book arrives as injected chunks and
 * page turns are in-page JS. So only the reader page itself and the blob:/
 * data: URLs foliate's paginator makes for section iframes are allowed; any
 * other http(s) navigation is refused.
 */
export function allowsReaderNavigation(url: string): boolean {
  if (url === READER_BASE_URL || url === READER_BASE_URL.replace(/\/$/, "")) return true;
  return !/^https?:\/\//i.test(url);
}

export interface TocItem { label: string; href: string; depth: number }

export interface SearchHit { cfi: string; excerpt: string }

/**
 * Which step of opening a book the page is on.
 *
 * The host shows these so a slow open reads as progress rather than as a
 * hang. Order matters - see STAGE_ORDER/stageLabel below. Keep in sync with
 * reader-page/main.js's stage() calls.
 */
/**
 * Why the read ended, which picks the plain-language line on the error card.
 *
 * The reader says what happened in ordinary words and keeps the technical
 * text for `errorMessage`; a renderer death is common enough, and specific
 * enough, to deserve its own sentence.
 */
export type ReaderErrorKind = "memory" | "unknown";

const ERROR_COPY: Record<ReaderErrorKind, MessageKey> = {
  memory: "reader.error.itNeededMoreMemoryThanThisPhoneCouldSpareTryingAgainOftenWorks",
  unknown: "reader.error.somethingWentWrongWhileOpeningIt",
};

export function errorCopy(kind: ReaderErrorKind): string {
  return t(ERROR_COPY[kind]);
}

export type ReaderStage = "receiving" | "assembling" | "parsing" | "rendering" | "locating";

const STAGES: ReaderStage[] = ["receiving", "assembling", "parsing", "rendering", "locating"];

const STAGE_LABELS: Record<ReaderStage, MessageKey> = {
  receiving: "reader.label.transferringBook",
  assembling: "reader.label.assemblingBook",
  parsing: "reader.label.readingBook",
  rendering: "reader.label.layingOutPages",
  locating: "reader.label.findingYourPlace",
};

export function stageLabel(stage: ReaderStage | null): string {
  return stage ? t(STAGE_LABELS[stage]) : t("reader.label.preparingBook");
}

export type PageMessage =
  | { type: "loaded" }
  | { type: "stage"; stage: ReaderStage }
  | { type: "toc"; items: TocItem[] }
  | { type: "relocated"; location: string; fraction: number; section: string | null }
  // x/y are fractions of the page's width/height (0..1), measured in the
  // top-level page's viewport - the page translates them out of foliate's
  // section iframe, which in paginated flow is as wide as the whole chapter.
  | { type: "tap"; x: number; y: number }
  // The paginator already turned (or is turning) the page from this touch;
  // the host only needs to know the reader was swiped.
  | { type: "swipe" }
  // A finger held still on the page: show the controls, wherever it landed.
  | { type: "hold" }
  | { type: "error"; message: string }
  | { type: "externalLink"; href: string }
  | { type: "searchResults"; gen: number; items: SearchHit[] }
  | { type: "searchDone"; gen: number }
  | { type: "searchError"; gen: number; message: string };

export function parsePageMessage(raw: string): PageMessage | null {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  switch (m.type) {
    case "loaded": return { type: "loaded" };
    case "stage":
      return typeof m.stage === "string" && (STAGES as string[]).includes(m.stage)
        ? { type: "stage", stage: m.stage as ReaderStage }
        : null;
    case "tap":
      return typeof m.x === "number" && Number.isFinite(m.x) && typeof m.y === "number" && Number.isFinite(m.y)
        ? { type: "tap", x: m.x, y: m.y }
        : null;
    case "swipe": return { type: "swipe" };
    case "hold": return { type: "hold" };
    case "toc":
      return Array.isArray(m.items)
        ? { type: "toc", items: m.items.filter((i): i is TocItem => !!i && typeof (i as TocItem).label === "string") }
        : null;
    case "relocated":
      return typeof m.location === "string" && typeof m.fraction === "number"
        ? { type: "relocated", location: m.location, fraction: m.fraction, section: typeof m.section === "string" ? m.section : null }
        : null;
    case "error":
      return typeof m.message === "string" ? { type: "error", message: m.message } : null;
    case "externalLink":
      return typeof m.href === "string" ? { type: "externalLink", href: m.href } : null;
    case "searchResults":
      return Array.isArray(m.items) && typeof m.gen === "number"
        ? {
            type: "searchResults",
            gen: m.gen,
            items: m.items.filter(
              (i): i is SearchHit =>
                !!i && typeof (i as SearchHit).cfi === "string" && typeof (i as SearchHit).excerpt === "string",
            ),
          }
        : null;
    case "searchDone":
      return typeof m.gen === "number" ? { type: "searchDone", gen: m.gen } : null;
    case "searchError":
      return typeof m.message === "string" && typeof m.gen === "number"
        ? { type: "searchError", gen: m.gen, message: m.message }
        : null;
    default: return null;
  }
}

export interface ReaderUiState {
  status: "preparing" | "ready" | "error";
  /** The page's current opening step, for the preparing overlay. */
  stage: ReaderStage | null;
  errorKind: ReaderErrorKind;
  errorMessage: string | null;
  toc: TocItem[];
  location: string | null;
  fraction: number;
  section: string | null;
  chromeVisible: boolean;
}

export const INITIAL_UI: ReaderUiState = {
  status: "preparing", stage: null, errorKind: "unknown", errorMessage: null, toc: [], location: null, fraction: 0, section: null, chromeVisible: true,
};

export type ReaderUiEvent =
  | PageMessage
  | { type: "toggleChrome" }
  | { type: "setChrome"; visible: boolean }
  // Retry after a terminal failure: puts the reader back to its opening
  // state so a remounted WebView starts from a clean slate.
  | { type: "reset" }
  // Android told us the WebView's renderer process died (onRenderProcessGone).
  | { type: "rendererGone" };

export function readerReducer(state: ReaderUiState, ev: ReaderUiEvent): ReaderUiState {
  switch (ev.type) {
    case "reset": return INITIAL_UI;
    case "loaded": return state;
    // Never let a late stage message drag a ready book back to "preparing":
    // the page keeps reporting stages right up to `locating`, and `relocated`
    // (which flips status to ready) can land first.
    case "stage":
      return state.status === "preparing" ? { ...state, stage: ev.stage } : state;
    case "toc": return { ...state, toc: ev.items };
    case "relocated":
      return { ...state, status: "ready", location: ev.location, fraction: ev.fraction, section: ev.section };
    // A tap's outcome depends on where it landed relative to the controls,
    // which needs the page's measured height and safe-area insets - see
    // decideTap below and its caller in BookReader. The message itself is a
    // state no-op here.
    case "tap": return state;
    // Swiping means reading: the controls get out of the way.
    case "swipe": return { ...state, chromeVisible: false };
    // Holding means "give me the controls" - unlike a tap, it does the same
    // thing wherever on the page it lands, so it always works even when the
    // reader is showing and the finger is over a page-turn zone.
    case "hold": return { ...state, chromeVisible: true };
    case "toggleChrome":
      return { ...state, chromeVisible: !state.chromeVisible };
    case "setChrome": return { ...state, chromeVisible: ev.visible };
    case "error": return { ...state, status: "error", errorKind: "unknown", errorMessage: ev.message };
    case "rendererGone":
      return {
        ...state,
        status: "error",
        errorKind: "memory",
        errorMessage: "The WebView renderer process stopped.",
      };
    case "externalLink": return state;
    // Search state (query, results, in-flight status, error) lives in the
    // search sheet's own component state, not this reducer - these are
    // state no-ops. In particular, a search failure must NOT become
    // ui.status "error" (that's the terminal, whole-reader fallback) - it's
    // reported to the search sheet instead (see BookReader's onMessage).
    case "searchResults": return state;
    case "searchDone": return state;
    case "searchError": return state;
  }
}

/**
 * How far along the preparing overlay's bar should be.
 *
 * Only the transfer has a real measurable fraction (bytes delivered); the
 * steps after it are discrete, so each one claims a fixed slice. The bar is
 * therefore coarse by construction - the honest detail is the stage label
 * beside it, which names what is actually running.
 */
export function prepareProgress(stage: ReaderStage | null, delivered: number): number {
  const d = Math.min(1, Math.max(0, delivered));
  switch (stage) {
    case "assembling": return 0.6;
    case "parsing": return 0.72;
    case "rendering": return 0.85;
    case "locating": return 0.95;
    // "receiving" and the pre-first-message null both track real bytes.
    default: return d * 0.55;
  }
}

export interface TapDecision {
  /** Whether the controls should be visible after this tap. */
  chrome: boolean;
  /** -1 previous page, 1 next page, 0 stay. */
  turn: -1 | 0 | 1;
}

/** Left/right share of the page width that turns a page (in the middle band, controls hidden). */
export const TURN_ZONE = 0.25;

/**
 * The reader's tap model. Controls hide when you read, not when a clock runs
 * out:
 *
 * - Controls shown: any tap hides them and does nothing else. A tap that
 *   missed the X can only ever cost one more tap, never the reader's place.
 * - Controls hidden: a tap in the top or bottom band (where the controls
 *   live) shows them, so tapping the corner expecting an X produces the X.
 *   In the middle band the outer quarters turn a page and the centre shows
 *   the controls.
 *
 * Page turns therefore never happen while a control is on screen, and a
 * tap where a control would be never turns a page.
 *
 * Direction: the tap zones are independent of the UI language. `x` is a
 * physical fraction of the page width (0 is the left edge), so in every UI
 * language, Arabic, Hebrew and Persian included, the left quarter goes to the
 * previous page and the right quarter to the next, in reading order (the page
 * maps -1 and +1 to the paginator's prev() and next()).
 */
export function decideTap(tap: { x: number; y: number }, chromeVisible: boolean, bands: TapBands): TapDecision {
  if (chromeVisible) return { chrome: false, turn: 0 };
  const x = Math.min(1, Math.max(0, tap.x));
  const y = Math.min(1, Math.max(0, tap.y));
  if (y < bands.top || y > 1 - bands.bottom) return { chrome: true, turn: 0 };
  if (x < TURN_ZONE) return { chrome: false, turn: -1 };
  if (x > 1 - TURN_ZONE) return { chrome: false, turn: 1 };
  return { chrome: true, turn: 0 };
}

// bg/fg are resolved colors (from readerThemes.ts's themeById()), not a
// theme name - the page paints whatever it's given and has no notion of
// theme ids at all.
export interface PageConfig {
  name: string;
  format: "book" | "txt";
  fontSizePct: number;
  bg: string;
  fg: string;
  location: string | null;
  /** Text the page itself shows the host (search errors), in the chosen language. */
  texts?: { searchBookLoading: string };
}

export const jsInit = (config: PageConfig) => `window.__dosyaInit(${JSON.stringify(config)});true;`;
export const jsChunk = (base64: string) => `window.__dosyaChunk(${JSON.stringify(base64)});true;`;
export const jsOpen = () => `window.__dosyaOpen();true;`;
export const jsGoTo = (target: string) => `window.__dosyaGoTo(${JSON.stringify(target)});true;`;
export const jsTurn = (dir: -1 | 1) => `window.__dosyaTurn(${dir});true;`;
export const jsApply = (settings: { fontSizePct: number; bg: string; fg: string }) => `window.__dosyaApply(${JSON.stringify(settings)});true;`;
export const jsSearch = (query: string) => `window.__dosyaSearch(${JSON.stringify(query)});true;`;
export const jsSearchClear = () => `window.__dosyaSearchClear();true;`;
