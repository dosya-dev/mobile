import en from "@/i18n/messages/en.json";
import { makeT, type Messages, type T } from "@/i18n/translator";
import type { MessageKey } from "@/i18n/keys";
import type { UploadItem } from "./types";

const english = makeT("en", en as Messages, en as Messages);

/** The `error` and `errorMessage` fields for a failure worded by one of our catalog messages. */
export function errorFields(key: MessageKey, values?: Record<string, string | number>): Pick<UploadItem, "error" | "errorMessage"> {
  return { error: english(key, values), errorMessage: { key, values } };
}

/** The error text of a failed item, in the language chosen now. */
export function itemErrorText(item: Pick<UploadItem, "error" | "errorMessage">, t: T): string | undefined {
  const m = item.errorMessage;
  // Only while it still describes `error` (a later failure replaces `error` alone).
  return m && english(m.key, m.values) === item.error ? t(m.key, m.values) : item.error;
}

/**
 * An upload that failed on an HTTP answer.
 *
 * The message is shown to the person, so it is worded in the language chosen at
 * the time. The controller decides whether to retry from `status`, never from
 * the wording: a translated message must not stop a 5xx from being retried.
 * `status` is null when the message is the server's own text (shown as sent).
 */
export class UploadHttpError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "UploadHttpError";
    this.status = status;
  }
}
