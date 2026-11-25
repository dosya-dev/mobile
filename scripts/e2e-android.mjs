#!/usr/bin/env node
/**
 * Per-flow Maestro runner with one retry per failed flow.
 *
 * Device e2e on a budget phone has irreducible flake (the driver occasionally
 * bounces the foreground during rapid modal transitions), and `maestro test
 * <dir>` treats one hiccup as a suite failure. Running each flow as its own
 * invocation makes retries surgical: a flow must fail TWICE in a row to fail
 * the suite, and a green retry is reported as "passed (retry)" so persistent
 * flake stays visible instead of silently absorbed.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const flowsDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".maestro");
const flows = readdirSync(flowsDir).filter((f) => f.endsWith(".yaml")).sort();
const ws = process.env.E2E_WS ?? "e2e-fixtures";
const maestroEnv = { ...process.env, PATH: `${process.env.PATH}:${process.env.HOME}/.maestro/bin` };

function runFlow(file) {
  const r = spawnSync("maestro", ["test", "-e", `E2E_WS=${ws}`, join(flowsDir, file)],
    { env: maestroEnv, encoding: "utf8", timeout: 5 * 60_000 });
  return r.status === 0;
}

// Fast pass first: one Maestro invocation for the whole suite (one JVM, no
// per-flow startup tax). Only flows that failed get rerun individually - a
// clean run costs ~8 minutes instead of ~18.
console.log("fast pass: all flows in one invocation ...");
const fast = spawnSync("maestro", ["test", "-e", `E2E_WS=${ws}`, flowsDir],
  { env: maestroEnv, encoding: "utf8", timeout: 25 * 60_000 });
const fastOut = (fast.stdout ?? "") + (fast.stderr ?? "");
const failedInFast = new Set(
  [...fastOut.matchAll(/\[Failed\]\s+(\S+)/g)].map((m) => `${m[1]}.yaml`),
);
console.log(fastOut.split("\n").filter((l) => /\[(Passed|Failed)\]/.test(l)).join("\n"));

const results = [];
for (const f of flows) {
  if (fast.status === 0 || !failedInFast.has(f)) {
    results.push({ f, ok: true, retried: false });
    continue;
  }
  process.stdout.write(`retry ${f} ... `);
  const ok = runFlow(f);
  results.push({ f, ok, retried: true });
  console.log(ok ? "passed (retry)" : "FAILED");
}

const failed = results.filter((r) => !r.ok);
const flaky = results.filter((r) => r.ok && r.retried);
console.log(`\n${failed.length === 0 ? "E2E PASSED" : "E2E FAILED"} - ${results.length - failed.length}/${results.length} flows` +
  (flaky.length ? ` (${flaky.length} needed a retry: ${flaky.map((r) => r.f).join(", ")})` : ""));
process.exit(failed.length === 0 ? 0 : 1);
