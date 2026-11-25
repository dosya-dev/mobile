import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// A QueryClient built without an explicit gcTime keeps TanStack's default
// 5-minute garbage-collection timer. That is a real Node timer, so jest cannot
// exit until it fires - which is why mobile-ci went red on a fully green suite:
// jest finished, never exited, and the step was killed after ~5 minutes.
//
// The query cache and the mutation cache each have their OWN gcTime default, so
// both need one. Zeroing only the queries side is what let this survive an
// earlier round of fixes: the tests that hung were precisely the ones that
// fired a mutation. Any finite or Infinite value is fine; only the unset
// default leaks.
const ROOTS = ["app", "src"];
const NEEDLE = "new QueryClient" + "(";

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...testFiles(full));
    else if (/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("test QueryClients cannot hold the jest worker open", () => {
  it("gives every test QueryClient an explicit gcTime on both caches", () => {
    const root = join(__dirname, "..", "..");
    const offenders = ROOTS.flatMap((r) => testFiles(join(root, r)))
      .filter((f) => f !== __filename)
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        if (!src.includes(NEEDLE)) return false;
        return !/queries:\s*\{[^}]*gcTime/.test(src) || !/mutations:\s*\{[^}]*gcTime/.test(src);
      })
      .map((f) => f.slice(root.length + 1));

    expect(offenders).toEqual([]);
  });

  it("finds the QueryClient constructions it is meant to police", () => {
    const root = join(__dirname, "..", "..");
    const withClients = ROOTS.flatMap((r) => testFiles(join(root, r)))
      .filter((f) => f !== __filename)
      .filter((f) => readFileSync(f, "utf8").includes(NEEDLE));

    // Guard against the scan silently matching nothing (a moved directory,
    // a renamed constructor) and passing for the wrong reason.
    expect(withClients.length).toBeGreaterThan(15);
  });
});
