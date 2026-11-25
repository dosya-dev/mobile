import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { PdfStage } from "./PdfStage";
import {
  nextPreviewState, PREVIEW_RETRY_SECONDS, type OfficePreviewState,
} from "../officePreview";
import type { StagePalette } from "../stageTheme";

/**
 * Office documents render as the PDF the server converts them to.
 *
 * This stage owns only the waiting. The conversion is asynchronous, so it polls
 * until the document is ready and then hands the same URL to PdfStage. The
 * decision about what each response means lives in officePreview.ts, which is
 * pure and tested; everything here is presentation.
 *
 * Read-only by design. Editing is the ONLYOFFICE web editor.
 */
export function OfficeStage(props: {
  /** The conversion endpoint, supplied by useFilePreview. */
  uri: string;
  headers?: Record<string, string>;
  palette: StagePalette;
  onTap?: () => void;
}) {
  // A file:// path is not something to wait for - it IS the finished
  // conversion, already on the device (useFilePreview's byte store hands one
  // over once the PDF has been cached). Polling it would be actively harmful,
  // not just wasteful: React Native's fetch is OkHttp-backed and rejects the
  // file: scheme, so the request throws, officePreview maps the resulting
  // status 0 to `failed`, and a document sitting on disk renders as "Could not
  // prepare a preview". Starting from `ready` also keeps the PDF mounted when
  // the URI switches mid-read, which is what used to throw away the reader's
  // scroll position and page.
  const t = useT();
  const converted = !/^https?:/i.test(props.uri);
  const [state, setState] = useState<OfficePreviewState>(
    converted ? { kind: "ready" } : { kind: "preparing", attempt: 0 },
  );
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (converted) {
      setState({ kind: "ready" });
      return;
    }
    setState({ kind: "preparing", attempt: 0 });

    (async () => {
      let current: OfficePreviewState = { kind: "preparing", attempt: 0 };
      while (!cancelled.current && current.kind === "preparing") {
        let status = 0;
        let code: string | undefined;
        try {
          // The body is discarded: this poll only asks "is it converted yet",
          // and PdfStage fetches the bytes itself once we say ready.
          const res = await fetch(props.uri, props.headers ? { headers: props.headers } : undefined);
          status = res.status;
          if (status === 422) {
            code = ((await res.json().catch(() => ({}))) as { code?: string }).code;
          }
        } catch {
          status = 0;
        }
        current = nextPreviewState(current, { status, code });
        if (cancelled.current) return;
        setState(current);
        if (current.kind === "preparing") {
          await new Promise((r) => setTimeout(r, PREVIEW_RETRY_SECONDS * 1000));
        }
      }
    })();

    return () => { cancelled.current = true; };
  }, [props.uri, props.headers, converted]);

  if (state.kind === "ready") {
    return (
      <PdfStage
        uri={props.uri}
        headers={props.headers}
        palette={props.palette}
        onTap={props.onTap}
      />
    );
  }

  const message =
    state.kind === "preparing" ? t("common.status.preparingPreview")
    : state.kind === "too-large" ? t("common.error.thisFileIsTooLargeToPreviewDownloadIt")
    : state.kind === "unsupported" ? t("common.error.thisFileTypeCannotBePreviewedDownloadItInstead")
    : state.message;

  return (
    <View
      className="flex-1 items-center justify-center px-8"
      style={{ backgroundColor: props.palette.bg }}
      testID={`office-${state.kind}`}
    >
      {state.kind === "preparing" ? <ActivityIndicator color={props.palette.fgMuted} /> : null}
      <Text className="mt-3 text-center text-sm text-muted-foreground">{message}</Text>
    </View>
  );
}
