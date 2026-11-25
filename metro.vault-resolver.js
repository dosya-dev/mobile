// The vendored e2ee bundle (vendor/e2ee-core, vendor/e2ee-client) inlines
// @hpke/common, which keeps `await import("crypto")` as a Node-only fallback
// for runtimes without `globalThis.crypto`. The app installs that global at
// boot (src/vault/cryptoGlobal.ts), so the fallback is dead at runtime - but
// Metro resolves dynamic imports at bundle time and fails the build on a
// builtin it cannot find. Answer those requests with an empty module and
// leave everything else to the resolver Metro would have used.
const NODE_ONLY = new Set(["crypto", "node:crypto"]);
const EMPTY = { type: "empty" };

function resolveVaultRequest(previous) {
  return (context, moduleName, platform) => {
    if (NODE_ONLY.has(moduleName)) return EMPTY;
    const next = previous ?? context.resolveRequest;
    return next(context, moduleName, platform);
  };
}

module.exports = { resolveVaultRequest };
