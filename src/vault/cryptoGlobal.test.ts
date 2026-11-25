import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installRandomGlobals, installSubtleGlobal } from "./cryptoGlobal";

type CryptoLike = { getRandomValues?: unknown; randomUUID?: unknown; subtle?: unknown };

function freshTarget(): { crypto?: CryptoLike } {
  return {};
}

describe("crypto globals for Hermes", () => {
  it("defines crypto with getRandomValues and randomUUID when the runtime has none", () => {
    const t = freshTarget();
    installRandomGlobals(t as unknown as typeof globalThis);
    const c = t.crypto!;
    expect(typeof c.getRandomValues).toBe("function");
    expect(typeof c.randomUUID).toBe("function");
    const a = (c.getRandomValues as (u: Uint8Array) => Uint8Array)(new Uint8Array(16));
    expect(a.length).toBe(16);
    expect(a.some((b) => b !== 0)).toBe(true);
    expect(c.randomUUID as () => string).toBeDefined();
    expect((c.randomUUID as () => string)()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("leaves an existing getRandomValues and randomUUID alone", () => {
    const mine = { getRandomValues: () => "mine", randomUUID: () => "mine" };
    const t = { crypto: mine };
    installRandomGlobals(t as unknown as typeof globalThis);
    expect(t.crypto.getRandomValues).toBe(mine.getRandomValues);
    expect(t.crypto.randomUUID).toBe(mine.randomUUID);
  });

  it("installs subtle only when absent, never replacing a real one", () => {
    const shim = { digest: () => Promise.resolve(new ArrayBuffer(0)) };
    const t = freshTarget();
    installRandomGlobals(t as unknown as typeof globalThis);
    installSubtleGlobal(shim, t as unknown as typeof globalThis);
    expect(t.crypto!.subtle).toBe(shim);
    const other = { digest: () => Promise.resolve(new ArrayBuffer(1)) };
    installSubtleGlobal(other, t as unknown as typeof globalThis);
    expect(t.crypto!.subtle).toBe(shim);
  });

  it("the boot polyfill imports only expo-crypto, never the 3 MB e2ee bundle", () => {
    const src = readFileSync(join(__dirname, "cryptoGlobal.ts"), "utf8");
    expect(src).not.toContain("@dosya-dev/e2ee-core");
    expect(src).not.toContain("@dosya-dev/e2ee-client");
    expect(src).toContain('from "expo-crypto"');
  });

  it("index.js installs the random globals before anything else", () => {
    const src = readFileSync(join(__dirname, "..", "..", "index.js"), "utf8");
    const firstImport = src.indexOf("import ");
    expect(src.indexOf('import "./src/vault/cryptoGlobal"')).toBe(firstImport);
  });
});
