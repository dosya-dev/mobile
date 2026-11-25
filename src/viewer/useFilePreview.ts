import { useCallback, useEffect, useMemo, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import { getDownloadUrl } from "@/files/api";
import { filePreviewPdfUrl } from "@/files/fileUrl";
import { getAccessToken } from "@/auth/authStore";
import { isViewOnly, needsUnlock, viewOnlySource } from "@/files/lock";
import { fileKind } from "@/files/format";
import { ensureLocal, localUri, type StoreOpts } from "@/files/byteStore";
import type { FileDetail } from "@/files/types";
import { chooseSource, savedCopy, type SavedCopy, type ViewerSource } from "@/offline/read";
import { useIsOnline } from "@/offline/network";

/**
 * Kinds worth keeping on the device, and why the others are not here.
 *
 * `text` is fetched into memory with `fetch`, which cannot read a file:// URL -
 * pointing it at one would break the preview outright. `image` already reuses
 * expo-image's disk cache through a deliberately stable /raw URL (see
 * imageSource.ts); giving it a second cache would only fight that one. `audio`
 * has the player's own cache, with prefetch and eviction tuned to a queue.
 * `video` streams perfectly well and a couple of them would fill the cap on
 * their own.
 */
const CACHEABLE = new Set(["office", "pdf", "book", "other"]);

/** The inline text-preview cap. Above this the body is not fetched at all. */
export const MAX_INLINE_TEXT_BYTES = 200 * 1024;

/**
 * How long a presigned URL has to stay valid for a file the device PLAYS.
 *
 * The default is 300s (`DEFAULT_DOWNLOAD_TTL`), which is fine for anything read
 * in one go and wrong for anything streamed: AVPlayer and ExoPlayer issue Range
 * requests across the whole of a file for as long as it is open, so a 512MB
 * video stopped playing about five minutes in with a 403 on the next range. A
 * short clip finishes buffering inside the window, which is why only big files
 * failed and why it read as "big videos don't play".
 *
 * 3600 is the server's `MAX_DOWNLOAD_TTL` - asking for more is silently clamped.
 * `player/resolver.ts` already does this for the queue; this is the same fix for
 * the stage, which never got it.
 */
export const STREAM_URL_TTL_SECONDS = 3600;

/** Kinds a native player holds open and reads in ranges over time. */
const STREAMED = new Set(["video", "audio"]);

export interface FilePreview {
  /** Where the stage reads bytes from, once known. */
  uri: string | null;
  /** Bearer header for the authenticated /raw route; undefined for presigned URLs. */
  headers: Record<string, string> | undefined;
  /** The decoded body, for text stages only. */
  text: string | null;
  /** A text body deliberately not fetched because it is over the cap. */
  textTooLarge: boolean;
  /** The URL could not be resolved, or the body could not be read. */
  failed: boolean;
  /** Re-runs whichever step failed. */
  retry: () => void;
  /** "saved" when the bytes are the offline copy on this phone; null until that is known. */
  source: ViewerSource["kind"] | null;
  /** Online, from Files, a saved copy is shown while the server has a newer version: offer it. */
  newerAvailable: boolean;
  /** A saved copy is shown while a newer version waits (offline, or from the Offline screen). */
  updatePending: boolean;
  /** An office file is saved but its PDF is not, and we may not fetch one here. */
  renditionUnavailable: boolean;
}

export interface PreviewOptions {
  /** Where the viewer was opened from; the Offline screen never streams a replacement. */
  origin?: "offline-screen" | "files";
  /** The user tapped "Open newer version" for this file. */
  userAskedNewer?: boolean;
}

/**
 * Resolve the bytes behind a preview.
 *
 * Two routes, chosen by lock mode and not negotiable:
 *  - view_only streams from the authenticated /raw route. `download-url` 403s a
 *    view-only file before it ever presigns, so presigning is not a fallback,
 *    it is a guaranteed failure.
 *  - everything else presigns, including a full_lock file once its unlock token
 *    is in hand.
 *
 * The failure flag is the part the old screen lacked. It swallowed both
 * rejections with a bare `.catch(() => {})`, which left the preview spinner
 * running forever on a dropped connection with no way to retry and no way to
 * tell a slow file from a dead one.
 */
export function useFilePreview(file: FileDetail | undefined, unlockToken: string | null, opts: PreviewOptions = {}): FilePreview {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const gated = !!file && needsUnlock(file, unlockToken);
  const viewOnly = !!file && isViewOnly(file);
  const kind = file ? fileKind(file.mime_type, file.extension) : "other";
  const textTooLarge = !!file && kind === "text" && file.size_bytes > MAX_INLINE_TEXT_BYTES;

  // Memoised so `headers` is referentially stable: viewOnlySource builds a
  // fresh object on every call, and an unstable headers object in the text
  // effect's dependency array below would re-fetch the body on every unrelated
  // re-render.
  const rawSource = useMemo(
    () => (file && viewOnly ? viewOnlySource(file) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file?.id, file?.current_version, viewOnly],
  );

  // An office document resolves to the server's PDF conversion, not to its raw
  // bytes - no PDF viewer can read a docx. Memoised for the same reason
  // rawSource is: an unstable headers object re-fires the text effect below.
  // Annotated: without it the ternary below infers a union of two object shapes
  // rather than Record<string, string>, which then will not assign to headers.
  const officeSource = useMemo<{ uri: string; headers: Record<string, string> } | null>(() => {
    if (!file || kind !== "office") return null;
    const token = getAccessToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    return { uri: filePreviewPdfUrl(file.id), headers };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, kind]);

  /**
   * An office document previews as the PDF the server converted, so that -
   * not the .docx - is what is worth keeping. Its own key, or it would
   * overwrite the original's bytes.
   */
  const storeOpts = useMemo<StoreOpts | undefined>(
    () => (kind === "office" ? { variant: "pdf", ext: "pdf" } : undefined),
    [kind],
  );
  const cacheable = !!file && !gated && !viewOnly && CACHEABLE.has(kind);

  // The offline copy, if this file is available offline. Asked before anything
  // goes to the network: a pinned file opens from the phone, and a phone with
  // no connection must not first fail a presign and flash an error. Only an
  // unrestricted file qualifies - one that has since been locked is the
  // server's to judge, and the next sync removes its copy.
  const online = useIsOnline();
  const origin = opts.origin ?? "files";
  const offlineEligible = !!file && file.lock_mode === "none" && !gated;
  const [saved, setSaved] = useState<{ id: string; orig: SavedCopy | null; pdf: SavedCopy | null } | null>(null);
  useEffect(() => {
    setSaved(null);
    if (!file || !offlineEligible) return;
    let alive = true;
    const id = file.id;
    Promise.all([savedCopy(id), kind === "office" ? savedCopy(id, { variant: "pdf" }) : Promise.resolve(null)])
      .then(([orig, pdf]) => { if (alive) setSaved({ id, orig, pdf }); })
      .catch(() => { if (alive) setSaved({ id, orig: null, pdf: null }); });
    return () => { alive = false; };
    // `attempt`: Retry looks again, so a saved copy removed while this file
    // was open is not asked for for ever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, file?.current_version, kind, offlineEligible, attempt]);
  const offlineResolved = !offlineEligible || saved?.id === file?.id;
  // An office file previews as its PDF, so that is the copy that counts.
  const displaySaved = offlineEligible && saved?.id === file?.id ? (kind === "office" ? saved.pdf : saved.orig) : null;
  const source = chooseSource({
    saved: displaySaved,
    serverVersion: file?.current_version ?? null,
    online,
    origin,
    userAskedNewer: !!opts.userAskedNewer,
  });
  const fromSaved = offlineResolved && source.kind === "saved";
  // Saved without its PDF: streaming the conversion is fine online from Files,
  // but offline, or from the Offline screen (which never starts a transfer),
  // there is nothing to show.
  const renditionUnavailable = offlineResolved && offlineEligible && kind === "office"
    && !!saved?.orig && !saved.pdf && (online === false || origin === "offline-screen");
  // Nothing goes to the network until we know there is no saved copy to show.
  const holdNetwork = !offlineResolved || fromSaved || renditionUnavailable;

  const [local, setLocal] = useState<string | null>(null);

  // Ask the device first. A hit means this open costs nothing at all.
  //
  // Keyed on the file's id and version rather than the object, for the same
  // reason rawSource is memoised that way: a caller that rebuilds the file
  // object on each render would otherwise re-run this every render, and the
  // `setLocal(null)` at the top would clear the answer before it could be used.
  useEffect(() => {
    setLocal(null);
    if (!file || !cacheable || holdNetwork) return;
    let alive = true;
    localUri(file, storeOpts)
      .then((hit) => { if (alive && hit) setLocal(hit); })
      .catch(() => {}); // a cache miss and a broken cache are the same thing here
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, file?.current_version, cacheable, storeOpts, holdNetwork]);

  const uri = fromSaved && source.kind === "saved"
    ? source.uri
    : holdNetwork ? null : (local ?? officeSource?.uri ?? rawSource?.uri ?? url);
  // A local file needs no credential, and passing one would make expo's
  // downloader treat a file:// path as an authenticated request.
  const headers = fromSaved || local ? undefined : (officeSource?.headers ?? rawSource?.headers);

  // Resolving a new file must not leave the previous file's URL on screen -
  // in a pager, that renders the wrong image under the right filename.
  useEffect(() => {
    setUrl(null);
    setText(null);
    setFailed(false);
  }, [file?.id]);

  useEffect(() => {
    if (!file) return;
    if (gated) return; // no bytes until the password lands
    if (viewOnly) return; // served from /raw, never presigned
    if (holdNetwork) return; // the saved copy, or still finding out whether there is one
    let alive = true;
    // A long-lived URL is a wider window for a leaked link, so it is spent only
    // where a player genuinely needs one - not on every presign.
    const ttl = STREAMED.has(kind) ? STREAM_URL_TTL_SECONDS : undefined;
    getDownloadUrl(file.id, unlockToken ?? undefined, ttl)
      .then((u) => { if (alive) { setUrl(u); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, gated, viewOnly, unlockToken, kind, attempt, holdNetwork]);

  useEffect(() => {
    if (!uri || !file) return;
    if (kind !== "text") return;
    if (textTooLarge) return;
    let alive = true;
    // fetch cannot read a file:// URL, so the saved copy is read from disk.
    const body = fromSaved
      ? FileSystem.readAsStringAsync(uri)
      : fetch(uri, headers ? { headers } : undefined).then((r) => {
        // fetch resolves for a 4xx/5xx. Reading the body regardless is how the
        // old screen ended up rendering `{"ok":false,...}` as the preview.
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      });
    body
      .then((t) => { if (alive) { setText(t); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, headers, kind, textTooLarge, file?.id, attempt, fromSaved]);

  /**
   * Fill the cache behind the preview that is already rendering.
   *
   * Deliberately not on the critical path: making first paint wait for a whole
   * document to land would trade a fast open today for a faster one tomorrow.
   * The stage streams as it always did, and the NEXT open reads from disk.
   */
  useEffect(() => {
    if (!file || !cacheable || local || holdNetwork) return;
    const networkUri = officeSource?.uri ?? url;
    if (!networkUri) return;
    // Fills the cache and deliberately does NOT adopt the result for this open -
    // hence no setLocal here. The path is picked up by the cache-hit effect
    // above on the NEXT open, which is exactly what the note says.
    //
    // Adopting it now would change `uri` under a stage that is already
    // rendering, remounting the viewer and discarding the reader's scroll
    // position and page mid-read. For an office document it did worse: the URI
    // and headers both change, which re-triggers OfficeStage's poll, and React
    // Native's fetch rejects file:// - so a document already on the device
    // became "Could not prepare a preview".
    ensureLocal(file, () => Promise.resolve(networkUri), {
      ...storeOpts,
      headers: officeSource?.headers,
    }).catch(() => {}); // caching is an optimisation; never surface its failures
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, file?.current_version, cacheable, local, officeSource, url, storeOpts, holdNetwork]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  const newer = fromSaved && source.kind === "saved" && source.newer;
  return {
    uri, headers, text, textTooLarge, failed, retry,
    source: offlineResolved ? (fromSaved ? "saved" : "stream") : null,
    newerAvailable: newer && origin === "files" && online !== false,
    updatePending: newer && (online === false || origin === "offline-screen"),
    renditionUnavailable,
  };
}
