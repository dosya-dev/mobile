// Gate for handing document-supplied link targets (markdown, EPUB content) to
// Linking.openURL. Untrusted content can embed custom schemes (myapp://...)
// or javascript:-style strings that the platform opener would otherwise
// follow unchanged, so only the web scheme is allowed through.
const ALLOWED_URL_SCHEMES = new Set(["https:"]);

export function isSafeExternalUrl(url: string): boolean {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim());
  if (!match) return false;
  return ALLOWED_URL_SCHEMES.has(`${match[1].toLowerCase()}:`);
}
