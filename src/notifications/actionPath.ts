/**
 * Server-authored notification links are WEB routes: the API's validateLinkPath
 * only checks that a path is internal and absolute (see
 * apps/api/src/lib/notifications/logic.ts), and the stored values are things
 * like "/files/abc". Mobile's routes do not match - a file is "/file/:id"
 * singular here, and mobile has no equivalent at all for surfaces like /vault.
 *
 * Returning null means "no equivalent", and callers MUST hide the action rather
 * than navigate. A button that opens a blank screen is worse than no button.
 *
 * MAINTENANCE: a new server-side link_path target needs an entry below, or that
 * action silently disappears on mobile.
 *
 * The desktop and web table lives in
 * packages/shared/src/notifications/action-path.ts. Mobile keeps its own
 * because it is decoupled from that package and only needs its own rules.
 */

interface Rule {
  re: RegExp;
  to: (m: RegExpMatchArray) => string;
}

const RULES: Rule[] = [
  { re: /^\/files\/([^/?#]+)\/?$/, to: (m) => `/file/${m[1]}` },
  { re: /^\/files\/?$/, to: () => "/(tabs)/(files)" },
  { re: /^\/shared\/?$/, to: () => "/shares" },
  { re: /^\/teams\/?$/, to: () => "/teams" },
  { re: /^\/workspaces\/?$/, to: () => "/workspaces" },
  { re: /^\/profile\/?$/, to: () => "/profile" },
  { re: /^\/notifications\/?$/, to: () => "/notifications" },
  // The Vault screen lives inside the Files tab's stack, so the tab bar stays
  // up. Only the surface itself: a link into a single Space has no mobile
  // equivalent, and sending it to the Vault root would open the wrong thing.
  { re: /^\/vault\/?$/, to: () => "/vault" },
  // A support reply (support_chat_reply) opens the live chat screen.
  { re: /^\/support\/chat\/?$/, to: () => "/support-chat" },
  // Deliberately no /activity rule. Mobile has no activity feed, and routing it
  // to the inbox would land the user on a different feed while the button
  // claimed otherwise. Fail closed instead.
];

export function mapActionPath(path: string | null | undefined): string | null {
  if (typeof path !== "string" || path.length === 0) return null;
  if (!path.startsWith("/")) return null;
  if (path.startsWith("//")) return null;
  for (const rule of RULES) {
    const m = path.match(rule.re);
    if (m) return rule.to(m);
  }
  return null;
}
