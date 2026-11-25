// index.js imports ./background.ts at module scope (the Android headless task
// and the native windows must be connected before any UI mounts), and
// app/_layout.tsx imports ./schedule.ts. Metro runs with inlineRequires off,
// so everything those modules import at module scope runs at every app start.
// The engine (and through it the 3 MB e2ee bundle) must load only when a
// window or a Personas screen needs it. These guards fail the moment a
// convenient import puts it back on the boot path.
import * as fs from "fs";
import * as path from "path";

const mockLoaded: string[] = [];
jest.mock("@dosya-dev/personas-engine", () => {
  mockLoaded.push("@dosya-dev/personas-engine");
  return {};
});
jest.mock("@dosya-dev/e2ee-core", () => {
  mockLoaded.push("@dosya-dev/e2ee-core");
  return {};
});
jest.mock("@dosya-dev/e2ee-client", () => {
  mockLoaded.push("@dosya-dev/e2ee-client");
  return {};
});
jest.mock("@sentry/react-native", () => ({ addBreadcrumb: jest.fn(), captureException: jest.fn() }));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));

const ROOT = path.resolve(__dirname, "../../..");
const BOOT = ["src/personas/device/background.ts", "src/personas/device/schedule.ts", "src/personas/device/health.ts"];
const HEAVY = /^@dosya-dev\/(personas-engine|e2ee-core|e2ee-client)$/;

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.tsx"), path.join(base, "index.js")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** Module-scope value imports (`import type` and type-only braces skipped; require() inside functions is lazy). */
function staticImports(file: string): string[] {
  const s = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1]) continue;
    if (m[2] && /^\{\s*(?:type\s+[^,}]+,?\s*)+\}$/.test(m[2])) continue;
    out.push(m[3] ?? m[4]);
  }
  return out;
}

describe("the Personas boot path stays clear of the engine", () => {
  it("no module-scope import chain from the boot modules reaches the engine or e2ee", () => {
    const parent = new Map<string, string | null>();
    const queue = BOOT.map((f) => path.join(ROOT, f));
    for (const f of queue) parent.set(f, null);
    const hits: string[] = [];
    while (queue.length) {
      const file = queue.shift()!;
      for (const spec of staticImports(file)) {
        if (HEAVY.test(spec)) {
          const chain = [file];
          for (let p = parent.get(file); p; p = parent.get(p)) chain.push(p);
          hits.push(`${spec} <- ${chain.map((c) => path.relative(ROOT, c)).join(" <- ")}`);
          continue;
        }
        const next = resolveLocal(file, spec);
        if (next && !parent.has(next)) {
          parent.set(next, file);
          queue.push(next);
        }
      }
    }
    expect(hits).toEqual([]);
    // The walk really went somewhere.
    expect(parent.size).toBeGreaterThan(10);
  });

  it("importing them does not load the engine or e2ee", () => {
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      require("./background");
      require("./schedule");
      require("./health");
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
    expect(mockLoaded).toEqual([]);
  });

  it("the guard itself sees a module that does load the engine", () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("./ports");
    });
    expect(mockLoaded).toContain("@dosya-dev/personas-engine");
  });
});
