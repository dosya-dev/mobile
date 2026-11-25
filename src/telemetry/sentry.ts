import * as Sentry from "@sentry/react-native";
import { stripBidi } from "@/lib/i18n";

/**
 * Crash and error reporting (Sentry, org dosya-pty-ltd, project react-native).
 *
 * Before this module the app had NO off-device error signal: the root
 * ErrorBoundary's componentDidCatch was a deliberate no-op, and an unhandled
 * promise rejection outside the React tree vanished. A release crash was
 * invisible until a user wrote in.
 *
 * What is reported: JS exceptions (global handler + unhandled rejections, both
 * wired by the SDK's default ReactNativeErrorHandlers integration), native
 * crashes on both platforms, and whatever the ErrorBoundary catches (see
 * `reportError`). Navigation breadcrumbs come from `navigationIntegration`,
 * registered against expo-router's container in app/_layout.tsx.
 *
 * What is NOT sent: the account's email or name. `setSentryUser` records the
 * opaque user id only, and `scrubEvent` strips anything an integration adds
 * on top (sendDefaultPii is off, so that is belt and braces). The DSN is a
 * public write-only key, so a checked-in default is fine; EXPO_PUBLIC_SENTRY_DSN
 * overrides it for a different project, and an EMPTY value turns reporting off.
 *
 * Off in dev builds by default - the red box already shows the error, and a
 * dev session's crashes would drown the dashboard. Set EXPO_PUBLIC_SENTRY_DEV=1
 * to exercise the pipeline from a dev build on the USB phone.
 *
 * Source maps: the `@sentry/react-native/expo` plugin (app.config.ts) plus
 * `getSentryExpoConfig` (metro.config.js) upload them at EAS build time, which
 * needs SENTRY_AUTH_TOKEN in the build environment (an EAS secret). Without it
 * the build still succeeds; stack traces just arrive unsymbolicated.
 */

export const DEFAULT_SENTRY_DSN =
  "https://726e1e86a0102af8e9f05d68efcd3378@o4512130123825152.ingest.de.sentry.io/4512130127167568";

/** Sample rate for performance traces. Errors are always sent. */
export const TRACES_SAMPLE_RATE = 0.1;

/** The two variables read, from `process.env` or a test's stand-in. */
export type SentryEnv = Record<string, string | undefined>;

/** The DSN to report to; `null` when reporting is switched off. */
export function resolveDsn(env: SentryEnv = process.env): string | null {
  const configured = env["EXPO_PUBLIC_SENTRY_DSN"];
  if (configured === undefined) return DEFAULT_SENTRY_DSN;
  const trimmed = configured.trim();
  return trimmed === "" ? null : trimmed;
}

/** Whether events should leave the device for this build. */
export function isSentryEnabled(env: SentryEnv = process.env, dev: boolean = __DEV__): boolean {
  if (resolveDsn(env) === null) return false;
  if (!dev) return true;
  return env["EXPO_PUBLIC_SENTRY_DEV"] === "1";
}

/** The slice of a Sentry event the scrubber touches. */
interface Scrubbable {
  user?: { id?: string | number } & Record<string, unknown>;
  message?: string;
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown> | null | undefined>;
}

/** stripBidi over the string values of one record, in place. Deeper values are left alone. */
function stripBidiValues(record: Record<string, unknown> | null | undefined): void {
  if (!record || typeof record !== "object") return;
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === "string") record[k] = stripBidi(v);
  }
}

/**
 * Drops personal fields an integration may have attached. The user id set by
 * `setSentryUser` survives; email, username and IP do not. Exported so the
 * rule is testable without a real SDK.
 */
export function scrubEvent<E extends Scrubbable>(event: E): E {
  if (event.user) {
    const { id } = event.user;
    event.user = id === undefined ? undefined : { id };
  }
  // A message built by t() in a right-to-left language carries direction
  // isolates around its names; they are display-only and never leave the app.
  if (typeof event.message === "string") event.message = stripBidi(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === "string") ex.value = stripBidi(ex.value);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.message === "string") crumb.message = stripBidi(crumb.message);
    // Console breadcrumbs carry the logged values in data.arguments.
    stripBidiValues(crumb.data);
  }
  stripBidiValues(event.extra);
  for (const ctx of Object.values(event.contexts ?? {})) stripBidiValues(ctx);
  return event;
}

/** The slice of a breadcrumb the breadcrumb scrubber touches. */
interface BreadcrumbLike {
  category?: string;
  data?: Record<string, unknown>;
}

/**
 * The Vault's identity endpoints, dropped from breadcrumbs (spec 8.1).
 *
 * The SDK's default breadcrumbs integration records every fetch/XHR as method,
 * url and status - no bodies, so no key material can be in one. What it would
 * still say is "this account ran the unlock ceremony at time T, and here is
 * whether it succeeded", attached to whatever crash follows. That is metadata
 * about the user's own secrets, and dosya has no use for it.
 */
const VAULT_BREADCRUMB_PATHS = ["/api/e2ee/oprf-evaluate", "/api/e2ee/user-keys"];

/** Exported so the rule is testable without a real SDK. */
export function scrubBreadcrumb<B extends BreadcrumbLike>(breadcrumb: B): B | null {
  if (breadcrumb.category !== "fetch" && breadcrumb.category !== "xhr") return breadcrumb;
  const url = breadcrumb.data?.["url"];
  if (typeof url === "string" && VAULT_BREADCRUMB_PATHS.some((path) => url.includes(path))) return null;
  return breadcrumb;
}

/** One instance, shared between init and the container registration. */
export const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

export function buildSentryOptions(env: SentryEnv = process.env, dev: boolean = __DEV__): Sentry.ReactNativeOptions {
  return {
    dsn: resolveDsn(env) ?? "",
    enabled: isSentryEnabled(env, dev),
    environment: dev ? "development" : "production",
    sendDefaultPii: false,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    integrations: [navigationIntegration],
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

let initialised = false;

/** Idempotent: app/_layout.tsx calls this at module scope. */
export function initSentry(): void {
  if (initialised) return;
  initialised = true;
  Sentry.init(buildSentryOptions());
}

/** Attach (or clear, with null) the signed-in account's opaque id. */
export function setSentryUser(userId: string | null): void {
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Report an error the app caught itself (boundaries, swallowed catches).
 *  Returns the event id, which a bug report carries as "Error reference". */
export function reportError(error: unknown, extra?: Record<string, unknown>): string | null {
  const id = Sentry.captureException(error, extra ? { extra } : undefined);
  return typeof id === "string" && id.length > 0 ? id : null;
}
