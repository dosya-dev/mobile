import { useEffect, useState } from "react";
import { CONTENT_DEBOUNCE_MS, searchContentWithRetry, type ContentHit } from "./api";

export type ContentState =
  | { state: "hidden" }
  | { state: "loading" }
  | { state: "busy" }
  | { state: "ok"; files: ContentHit[] };

/**
 * The "In file contents" results for `q`, run beside the name search and
 * never holding it up. Waits CONTENT_DEBOUNCE_MS after the query settles and
 * cancels the request a newer query replaces. Only a successful, complete
 * answer can say "no content matches": a partial one (keyword-only while the
 * index is paused or degraded) that found nothing proves nothing, so it hides
 * the section, as do "no AI search here" and errors.
 */
export function useContentSearch(workspaceId: string | null, q: string): ContentState {
  const [content, setContent] = useState<ContentState>({ state: "hidden" });
  const query = q.trim();
  useEffect(() => {
    if (!workspaceId || query.length < 2) { setContent({ state: "hidden" }); return; }
    const ctrl = new AbortController();
    setContent({ state: "loading" });
    const timer = setTimeout(() => {
      void searchContentWithRetry(workspaceId, query, {
        signal: ctrl.signal,
        onBusy: () => { if (!ctrl.signal.aborted) setContent({ state: "busy" }); },
      }).then((r) => {
        if (ctrl.signal.aborted) return;
        setContent(r.kind === "ok" && !(r.partial && r.files.length === 0) ? { state: "ok", files: r.files } : { state: "hidden" });
      });
    }, CONTENT_DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [workspaceId, query]);
  return content;
}
