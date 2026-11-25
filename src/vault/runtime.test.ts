const utf8 = (s: string) => new TextEncoder().encode(s);

// store.ts is the heavy, boot-isolated module (it pulls in the 3 MB e2ee
// bundle via engine.ts) - runtime.ts only ever reaches it through a lazy
// require(), and every test here must stay insulated from the real one.
jest.mock("./store", () => ({ startVaultBackgroundLock: jest.fn(() => () => {}) }));

// The core's backend registry is install-once per module instance and the
// vendored bundle exports no reset seam, so every test here starts from a
// fresh module registry (jest.resetModules) and requires BOTH the runtime and
// the core afterwards - a top-level import of the core would be a different
// instance from the one the runtime installs into. `require()` (not dynamic
// `import()`) matches this project's existing resetModules convention (see
// src/backup/folders.test.ts): jest's babel transform here doesn't lower
// dynamic import to CommonJS, so a native `import()` fails under jest without
// --experimental-vm-modules.
describe("ensureVaultRuntime", () => {
  let savedCrypto: unknown;
  beforeEach(() => {
    jest.resetModules();
    savedCrypto = (globalThis as { crypto?: unknown }).crypto;
  });
  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: savedCrypto, configurable: true, writable: true });
  });

  it("installs the mobile backend and the subtle shim once, and is idempotent", async () => {
    // Simulate Hermes: no WebCrypto at all, only what index.js installs.
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
    const { installRandomGlobals } = require("./cryptoGlobal") as typeof import("./cryptoGlobal");
    installRandomGlobals();
    const { ensureVaultRuntime } = require("./runtime") as typeof import("./runtime");
    const core = require("@dosya-dev/e2ee-core") as typeof import("@dosya-dev/e2ee-core");
    await ensureVaultRuntime();
    await ensureVaultRuntime();
    expect((await core.getCryptoBackend()).name).toBe("react-native-libsodium");
    const subtle = (globalThis as { crypto: { subtle?: { digest?: unknown } } }).crypto.subtle;
    expect(typeof subtle?.digest).toBe("function");
    // HPKE works with only the shim: this is the grant seal/open path on a phone.
    const kp = await core.generateHpkeKeyPair();
    const { enc, ciphertext } = await core.hpkeSeal(kp.publicKey, utf8("i"), utf8("WK"));
    expect(new TextDecoder().decode(await core.hpkeOpen(kp.privateKey, enc, utf8("i"), ciphertext))).toBe("WK");
  });

  it("starts the background lock once across two calls, importing it lazily", async () => {
    const { ensureVaultRuntime } = require("./runtime") as typeof import("./runtime");
    const { startVaultBackgroundLock } = require("./store") as { startVaultBackgroundLock: jest.Mock };
    await ensureVaultRuntime();
    await ensureVaultRuntime();
    expect(startVaultBackgroundLock).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed first attempt instead of caching the rejection", async () => {
    jest.doMock("./backend", () => {
      let calls = 0;
      return {
        createMobileBackend: async () => {
          calls += 1;
          if (calls === 1) throw new Error("native module unavailable");
          const real = jest.requireActual("./backend") as typeof import("./backend");
          return real.createMobileBackend();
        },
      };
    });
    const { ensureVaultRuntime } = require("./runtime") as typeof import("./runtime");
    const core = require("@dosya-dev/e2ee-core") as typeof import("@dosya-dev/e2ee-core");
    await expect(ensureVaultRuntime()).rejects.toThrow("native module unavailable");
    await expect(ensureVaultRuntime()).resolves.toBeUndefined();
    expect((await core.getCryptoBackend()).name).toBe("react-native-libsodium");
  });
});
