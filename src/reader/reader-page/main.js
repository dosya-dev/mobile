// Reader page glue: assembles base64 chunks sent from the host RN app into
// a book file, opens it with the vendored foliate-js <foliate-view>, and
// bridges navigation/relocation/errors back to the host via
// window.ReactNativeWebView.postMessage.
//
// Globals below (__dosyaInit/__dosyaChunk/__dosyaOpen/__dosyaGoTo/__dosyaApply
// /__dosyaSearch/__dosyaSearchClear) and the postMessage shapes are a fixed
// contract with the host - do not rename.

import "../../../vendor/foliate-js/view.js";
import { makeTxtBook } from "./txt.js";
import { createTouchClassifier, HOLD_MS } from "./tap.js";

const post = (msg) => window.ReactNativeWebView?.postMessage(JSON.stringify(msg));

// Progress reporting for the host's "preparing" overlay.
//
// Opening a book is several seconds of work on a low-end phone and every
// step of it happens in here, where the host can see nothing: it only ever
// learned the book was ready when the first `relocate` arrived. That made a
// stall anywhere in __dosyaOpen indistinguishable from a crash - both are
// just a spinner that never stops - so the host now gets told which step is
// running, and shows it. Keep these in sync with ReaderStage in bridge.ts.
const stage = (name) => post({ type: "stage", stage: name });

// The host now resolves theme ids to concrete colors itself (see
// src/reader/readerThemes.ts) and sends them directly - the page has no
// notion of theme names any more, it just paints whatever bg/fg it's given.
// `color-scheme` still needs a light/dark verdict (it drives native form
// control and scrollbar rendering inside the section iframes), so derive it
// from the resolved background's perceived luminance instead of a theme
// name.
function relativeLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return 1; // unrecognized input: assume light, matches prior default
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const readerCss = (s) => `
  html { color-scheme: ${relativeLuminance(s.bg) < 0.5 ? "dark" : "light"}; font-size: ${s.fontSizePct}%; }
  body { background: ${s.bg} !important; color: ${s.fg}; }
  a, a:visited { color: inherit; }
`;

let config = null;
let view = null;
let settings = null;
// Delivered book data, as Blobs rather than Uint8Arrays - see __dosyaChunk.
const chunks = [];
// Bumped on every __dosyaSearch call and on __dosyaSearchClear, so a search
// generator started for a since-superseded (or since-cleared) query can
// tell it's stale and stop posting - without this, typing "cat" then
// "cathedral" past the host's debounce runs two whole-book search
// generators concurrently and their results/done/error messages interleave
// on the host side.
let searchGen = 0;

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function flattenToc(items, depth = 0, out = []) {
  for (const item of items ?? []) {
    out.push({ label: item.label ?? "", href: item.href ?? "", depth });
    flattenToc(item.subitems, depth + 1, out);
  }
  return out;
}

function applySettings(next) {
  settings = next;
  // Set directly (not via readerCss's injected stylesheet) so the native
  // page-behind-the-iframe background updates synchronously and page turns
  // don't flash the previous theme's color before the new stylesheet lands.
  document.documentElement.style.background = next.bg;
  view?.renderer?.setStyles?.(readerCss(next));
}

function onRelocate(e) {
  const d = e.detail ?? {};
  post({
    type: "relocated",
    location: d.cfi ?? String(d.fraction ?? 0),
    fraction: d.fraction ?? 0,
    section: d.tocItem?.label ?? null,
  });
}

// Where a touch landed, as fractions of the top-level page's width and
// height. `frame` is the section iframe the touch came from, if any. In
// paginated flow vendor/foliate-js/paginator.js's expand() makes that iframe
// as wide as the whole chapter (pageCount * page width) and scrolls its
// container to pick the visible page, so a touch's clientX inside it is
// measured from the chapter's left edge, not the screen's - on page 3 of a
// chapter a tap at the screen's left edge has clientX = 2 * page width. The
// iframe's bounding rect in the parent (its `left` goes negative as the
// container scrolls) maps the point back onto the screen.
function pageFraction(touch, frame) {
  const rect = frame?.getBoundingClientRect?.();
  const x = (rect?.left ?? 0) + touch.clientX;
  const y = (rect?.top ?? 0) + touch.clientY;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return { x: clamp(x / (window.innerWidth || 1)), y: clamp(y / (window.innerHeight || 1)) };
}

// Taps and swipes are classified from touch events (see tap.js), not from
// the browser's synthesised `click`: WebKit on iOS only synthesises a click
// for targets it considers clickable, so a document-level click listener
// could miss a tap on plain paragraph text - and a reader whose
// tap-to-reveal misses has no way back to its controls. Touch events fire
// for every touch. The classifier is fed screen coordinates, which hold
// still while the paginator scrolls its container under the finger; the
// tap's position is then reported in top-level page fractions.
//
// The page reports WHERE the tap landed and lets the host decide what it
// means (bridge.ts's decideTap): only the host knows whether its controls
// are showing and how tall their bands are. A swipe is reported with no
// direction - the paginator turns the page from the same touch sequence,
// the host just needs to know reading resumed.
//
// Links stay foliate's: vendor/foliate-js/view.js's #handleLinks acts on the
// click that follows this touchend (internal goTo, or the external-link
// event wired up in __dosyaOpen), so a tap on an anchor is not also
// reported as a page tap.
function attachTouch(target, frameOf) {
  const classifier = createTouchClassifier();
  const first = (ev) => ev.changedTouches?.[0];
  const opts = { passive: true };
  // Hold-to-reveal. The timer belongs here rather than in tap.js so that
  // module stays pure numbers (it runs under jest with no DOM and no
  // clock); tap.js only answers whether the finger is still resting.
  let holdTimer = null;
  const clearHold = () => {
    if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
  };
  target.addEventListener("touchstart", (ev) => {
    const t = first(ev);
    if (!t) return;
    classifier.start(t.screenX, t.screenY, ev.timeStamp, ev.touches.length);
    clearHold();
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (!classifier.isHolding()) return;
      // Claim the gesture so the finger coming up does not also turn a page.
      classifier.consume();
      post({ type: "hold" });
    }, HOLD_MS);
  }, opts);
  target.addEventListener("touchmove", (ev) => {
    const t = first(ev);
    if (!t) return;
    classifier.move(t.screenX, t.screenY, ev.touches.length);
    // Sliding a finger is a swipe or a selection drag, never a hold.
    if (!classifier.isHolding()) clearHold();
  }, opts);
  target.addEventListener("touchcancel", () => { clearHold(); classifier.cancel(); }, opts);
  target.addEventListener("touchend", (ev) => {
    const t = first(ev);
    if (!t) return;
    clearHold();
    const verdict = classifier.end(t.screenX, t.screenY, ev.timeStamp, ev.touches.length);
    if (verdict === "swipe") post({ type: "swipe" });
    else if (verdict === "tap" && !ev.target?.closest?.("a[href]")) post({ type: "tap", ...pageFraction(t, frameOf()) });
  }, opts);
}

// The rendered book content lives inside a sandboxed same-origin <iframe>
// created by vendor/foliate-js/paginator.js (Paginator's `#iframe`), which
// sits inside <foliate-view>'s closed shadow root. A touch on that content
// does NOT bubble out to a listener on the <foliate-view> element itself
// (iframes are separate browsing contexts), so the touch handling has to
// attach to each rendered section's own `doc`, exactly like
// vendor/foliate-js's own reference reader does for its keydown handler.
// The View re-emits the renderer's `load` event as `{detail: {doc, index}}`
// once per section load (see view.js's `#onLoad`/`#emit('load', ...)`), so
// re-attach on every `load` rather than once. The strip of paginator chrome
// outside the iframe (its running header/footer) is covered by the listener
// on the view itself, added in __dosyaOpen.
function onLoad(e) {
  const doc = e.detail?.doc;
  if (!doc) return;
  attachTouch(doc, () => doc.defaultView?.frameElement ?? null);
}

// foliate-js emits this (cancelable) instead of navigating itself when a
// link resolves to an external URL (see view.js #handleLinks: it only calls
// `globalThis.open(href_, '_blank')` if this event's listeners don't cancel
// it). `globalThis.open` inside this WebView would either no-op or spawn an
// unwanted in-app browser view, so cancel it here and hand the URL to the
// host instead - the host opens it in the system browser via Linking.
function onExternalLink(e) {
  e.preventDefault();
  const href = e.detail?.href_ ?? e.detail?.a?.getAttribute?.("href") ?? "";
  if (href) post({ type: "externalLink", href });
}

window.__dosyaInit = (c) => { config = c; applySettings({ fontSizePct: c.fontSizePct, bg: c.bg, fg: c.fg }); };
window.__dosyaChunk = (b64) => {
  try {
    const b = base64ToBytes(b64);
    // Hand each chunk straight to blob storage and let the Uint8Array go.
    //
    // This is what makes a big book survivable. foliate opens an EPUB with
    // `new ZipReader(new BlobReader(file))` (vendor/foliate-js/view.js), so
    // it only ever slices the file on demand - the whole book never has to
    // be resident. Keeping Uint8Arrays here defeated that: the JS heap held
    // the entire book, __dosyaOpen then concatenated them into a SECOND
    // full copy, and `new File([buffer])` made a third while the first two
    // were still alive. Measured on a 100MB book, that assembly step alone
    // cost 205MB; going straight to Blobs halves it, and the bytes become
    // the browser's to page out instead of the renderer's to hold.
    chunks.push(new Blob([b]));
    stage("receiving");
  } catch (err) {
    // A malformed chunk means the transfer is corrupted and the book can
    // never open correctly, so this is a legitimate fatal error, not
    // something to swallow and degrade gracefully from.
    post({ type: "error", message: String(err?.message ?? err) });
  }
};
window.__dosyaApply = (s) => applySettings(s);
// Deliberately swallow goTo failures: a stale bookmark/CFI (e.g. from a
// re-imported or slightly different copy of the book) should just fail to
// jump, not drop the whole reader into the terminal error screen.
window.__dosyaGoTo = (target) => { view?.goTo(target)?.catch?.(() => {}); };
// Host-driven page turn: the host decides that a tap meant "next"/"previous"
// (bridge.ts's decideTap) and calls back in here. Same paginator entry points
// the swipe snapping ends up in, so the `animated` attribute applies.
window.__dosyaTurn = (dir) => {
  if (dir < 0) view?.renderer?.prev?.();
  else view?.renderer?.next?.();
};

const SEARCH_RESULT_CAP = 100;

// vendor/foliate-js/search.js's makeExcerpt (see its CONTEXT_LENGTH-bounded
// snippet builder) returns `{ pre, match, post }` - three plain-text pieces
// around the hit, with a leading/trailing "…" already included when the
// surrounding text was truncated - not a single string. The host's
// SearchHit type (bridge.ts) is `{ cfi, excerpt: string }`, so flatten the
// three pieces back into one string here on the page side before posting.
const excerptText = (excerpt) => `${excerpt?.pre ?? ""}${excerpt?.match ?? ""}${excerpt?.post ?? ""}`;

// vendor/foliate-js/view.js's View#search(opts) is an async generator, not a
// plain search(query) call:
//   - opts = { query } (no `index`) makes it search the WHOLE book via the
//     private #searchBook generator (view.js:530-541), not a single section.
//   - it yields a MIX of progress pings (`{ progress }`, no `cfi`/`subitems`
//     - dropped here, they're for a search-in-progress UI we don't have) and
//     per-section result batches (`{ label, subitems: [{ cfi, excerpt }] }`,
//     view.js:558-567) as each section finishes being searched.
//   - it always finishes with the literal string `'done'` (view.js:577),
//     not an object - there is no separate "search finished" event to
//     listen for.
// This is the real, load-bearing shape - the task's `{ type: "searchResults",
// items: [...] }` / `{ type: "searchDone" }` postMessage protocol is this
// generator's output reshaped into what the host expects, not a 1:1 mirror
// of a `search(query)` the library doesn't have.
// Search failures must never reach the host as a plain `{type:"error"}` -
// readerReducer treats that as terminal and swaps the whole reader to the
// "Couldn't open this book" screen (see bridge.ts), which would kill a
// perfectly healthy book over nothing worse than a failed search. Report
// search-side failures (including "not ready yet") as the distinct
// `searchError` type instead, which the host routes to the search sheet.
window.__dosyaSearch = async (query) => {
  const gen = ++searchGen;
  // ReaderChrome renders above the "preparing" overlay, so a user can open
  // Search while the book is still being delivered/opened - `view` is only
  // created at the end of __dosyaOpen. Without this guard, `view.search`
  // below throws on the null `view` and (before this fix) that fell through
  // to the generic error path.
  if (!view) {
    post({ type: "searchError", gen, message: config?.texts?.searchBookLoading ?? "The book is still loading - try searching again in a moment." });
    return;
  }
  try {
    let count = 0;
    for await (const result of view.search({ query })) {
      // A newer __dosyaSearch call or a __dosyaSearchClear bumped searchGen
      // since this generator started - stop immediately and post nothing
      // more (including the "done" below), so its stale results/done can't
      // interleave with (or prematurely stop the spinner for) whatever
      // superseded it.
      if (gen !== searchGen) return;
      if (result === "done") break;
      if (!result?.subitems?.length) continue; // a bare `{ progress }` ping
      const room = SEARCH_RESULT_CAP - count;
      if (room <= 0) break;
      const items = result.subitems
        .slice(0, room)
        .map(({ cfi, excerpt }) => ({ cfi, excerpt: excerptText(excerpt) }));
      count += items.length;
      // `gen` rides along on every message so the host can tell a batch
      // this generator already had in flight over the bridge apart from
      // one that actually belongs to whatever query is current there now -
      // see BookReader.tsx's currentGenRef/pendingGenRef.
      post({ type: "searchResults", gen, items });
      if (count >= SEARCH_RESULT_CAP) break;
    }
    if (gen === searchGen) post({ type: "searchDone", gen });
  } catch (err) {
    if (gen === searchGen) post({ type: "searchError", gen, message: String(err?.message ?? err) });
  }
};

// View#clearSearch() (view.js:579-583) removes the search-highlight
// overlayers `search()` drew as results came in (it also does this
// internally as its own first step, but a user closing the search sheet
// without running a new query still needs a way to clear the old
// highlights).
window.__dosyaSearchClear = () => {
  // Cancel any in-flight __dosyaSearch generator - closing the sheet (or
  // its Done button, which calls this) must stop stale work, not just hide
  // its output.
  searchGen++;
  try {
    view?.clearSearch?.();
  } catch (err) {
    post({ type: "searchError", message: String(err?.message ?? err) });
  }
};

window.__dosyaOpen = async () => {
  try {
    stage("assembling");
    // splice, not slice-then-clear: the module-level array must not keep a
    // reference to the parts once the File owns them.
    const parts = chunks.splice(0, chunks.length);

    stage("parsing");
    view = document.createElement("foliate-view");
    document.body.append(view);
    view.addEventListener("relocate", onRelocate);
    view.addEventListener("load", onLoad);
    view.addEventListener("external-link", onExternalLink);
    // Touches that land outside the section iframe (the paginator's own
    // header/footer strips) reach the view element directly, already in
    // top-level page coordinates.
    attachTouch(view, () => null);

    if (config.format === "txt") {
      const text = await new Blob(parts).text();
      await view.open(makeTxtBook(text, config.name));
    } else {
      await view.open(new File(parts, config.name));
    }
    stage("rendering");
    view.renderer?.setAttribute?.("flow", "paginated");
    // Turns on the paginator's eased page-turn animation. Without this
    // attribute, vendor/foliate-js/paginator.js's #scrollTo assigns the new
    // scroll offset outright and pages snap between positions with no motion;
    // with it, a page turn interpolates over 300ms (easeOutQuad). It gates
    // BOTH tap-zone turns (prev/next reach #scrollToPage(page, 'page', true))
    // and swipe snapping (reason === 'snap'), and it also drops #turnPage's
    // 100ms settle wait, since the animation itself now covers that time.
    view.renderer?.setAttribute?.("animated", "");
    applySettings(settings);
    post({ type: "toc", items: flattenToc(view.book?.toc) });
    stage("locating");
    if (config.location) {
      try { await view.init({ lastLocation: config.location }); }
      catch { view.renderer?.next?.(); }
    } else {
      view.renderer?.next?.();
    }
  } catch (err) {
    post({ type: "error", message: String(err?.message ?? err) });
  }
};

post({ type: "loaded" });
