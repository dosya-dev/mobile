#!/usr/bin/env node
/**
 * Real-device Android smoke test, driven entirely over adb/USB.
 *
 *   npm run smoke:android              # smoke the app already installed on the phone
 *   npm run smoke:android -- --install # install android/app/build/outputs/apk/release first
 *
 * Exists because nothing else can see this class of failure: jest mocks the
 * native modules and gradle proves compilation only, so "CI green, app dies on
 * the splash screen" has shipped before (see the RNTP TurboModule launch
 * crash). This is the pre-release gate: phone on USB, one command.
 *
 * PHASE 1 - boot health (always):
 *   device present + authorized; device online (an OFFLINE phone renders
 *   exactly like a hung app and burned a debugging session before this check
 *   existed); cold start; stable pid (a changing pid is a crash-loop); JS
 *   bundle booted; no fatal logcat signatures; no spurious "[auth] session
 *   dropped" (the logged-out-mid-backup bug); app is top resumed activity;
 *   the UI reached a real state - tab bar or login screen. Alive-but-blank
 *   (a stuck gate, an invisible overlay) is a FAIL: both have happened.
 *
 * PHASE 2 - feature flows (when signed in):
 *   every tab plus one read-only drill-down per surface: Files list renders
 *   rows; folder opens and backs out; search opens and closes; workspace
 *   switcher sheet opens and closes; Backup tab shows its engine screen;
 *   Settings shows the account card; Profile opens and backs out. All taps
 *   resolve their target's bounds from the live uiautomator dump - never
 *   hard-coded coordinates. Flows never mutate: nothing is uploaded, renamed,
 *   deleted, signed out, or toggled.
 *
 * Signed-out phones run phase 1 only (the login screen IS the healthy state);
 * feature flows report as skipped - this script never handles credentials.
 *
 * A screenshot is always saved as evidence, pass or fail.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = "dev.dosya";
const APK = join(dirname(fileURLToPath(import.meta.url)), "..", "android/app/build/outputs/apk/release/app-release.apk");
const BOOT_WAIT_S = 12;      // matches the long-standing manual verification loop
const UI_TIMEOUT_S = 30;     // JIT after a fresh install makes first cold starts slow
const doInstall = process.argv.includes("--install");
const allowOffline = process.argv.includes("--allow-offline");

const results = [];
let failed = false;

function step(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail ?? "" });
    console.log(`  ok   ${name}${detail ? `  (${detail})` : ""}`);
    return true;
  } catch (e) {
    failed = true;
    results.push({ name, ok: false, detail: e.message });
    console.log(`  FAIL ${name}\n       ${e.message.split("\n").join("\n       ")}`);
    return false;
  }
}

function skip(name, why) {
  results.push({ name, ok: true, detail: `skipped - ${why}` });
  console.log(`  skip ${name}  (${why})`);
}

function adb(args, opts = {}) {
  const r = spawnSync("adb", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`adb not runnable: ${r.error.message}`);
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status ?? 1 };
}

function shell(cmd) {
  return adb(["shell", cmd]).out.trim();
}

function sleep(s) {
  // Deliberately synchronous: every phase depends on the one before it.
  execFileSync(process.execPath, ["-e", `setTimeout(()=>{}, ${Math.round(s * 1000)})`]);
}

// ---------- uiautomator helpers: find by text, tap by bounds ----------

/** All visible nodes: [{ text, cx, cy }]. */
function dumpNodes() {
  shell("uiautomator dump /sdcard/smoke-ui.xml >/dev/null 2>&1 || true");
  const xml = shell("cat /sdcard/smoke-ui.xml 2>/dev/null");
  const nodes = [];
  for (const m of xml.matchAll(/<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*/g)) {
    const [, text, x1, y1, x2, y2] = m;
    if (!text) continue;
    nodes.push({ text, cx: (+x1 + +x2) / 2, cy: (+y1 + +y2) / 2 });
  }
  return nodes;
}

function screenHeight() {
  const m = shell("wm size").match(/(\d+)x(\d+)/);
  return m ? +m[2] : 1600;
}

/** Wait until a node whose text CONTAINS `text` exists (predicate optional). */
function waitFor(text, { timeoutS = 15, where = () => true } = {}) {
  const deadline = Date.now() + timeoutS * 1000;
  for (;;) {
    const hit = dumpNodes().find((n) => n.text.includes(text) && where(n));
    if (hit) return hit;
    if (Date.now() > deadline) {
      const seen = dumpNodes().map((n) => n.text).slice(0, 12).join(" | ") || "(blank screen)";
      throw new Error(`"${text}" never appeared. On screen: ${seen}`);
    }
    sleep(1.5);
  }
}

function tapNode(node) {
  shell(`input tap ${Math.round(node.cx)} ${Math.round(node.cy)}`);
  sleep(1.6); // navigation settle
}

/** Tap a bottom tab by its label - only nodes in the tab-bar region qualify,
 * so a heading with the same word (e.g. "Backup") can never steal the tap. */
function tapTab(label, height) {
  tapNode(waitFor(label, { where: (n) => n.cy > height * 0.82 }));
}

function back() {
  shell("input keyevent KEYCODE_BACK");
  sleep(1.4);
}

function appIsForeground() {
  return shell("dumpsys activity activities | grep topResumedActivity | head -1").includes(PKG);
}

/** Flows must be independent: if a previous flow's BACK escaped to the
 * launcher, re-enter the app and land on the Files tab before proceeding. */
function ensureApp(height) {
  if (!appIsForeground()) {
    shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
    sleep(2.5);
  }
  waitFor("Files", { timeoutS: 15, where: (n) => n.cy > height * 0.82 });
}

/** Dismiss an in-app screen with BACK, one press at a time, verifying we came
 * back to the Files list ("All" chip) instead of blindly double-pressing -
 * a second BACK from the root exits the app to the launcher. */
function backToFiles(height) {
  for (let i = 0; i < 3; i++) {
    back();
    if (!appIsForeground()) break; // overshot - ensureApp recovers below
    const nodes = dumpNodes();
    if (nodes.some((n) => n.text === "All") ) return;
  }
  ensureApp(height);
  waitFor("All", { timeoutS: 10 });
}

// ---------- phase 1: boot health ----------

console.log(`\nAndroid smoke test - ${PKG}\n`);
console.log("boot health");

step("device connected and authorized", () => {
  const { out } = adb(["devices"]);
  const rows = out.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
  const authorized = rows.filter((l) => l.endsWith("\tdevice"));
  if (rows.some((l) => l.endsWith("\tunauthorized")))
    throw new Error("Device is unauthorized - accept the USB debugging prompt on the phone.");
  if (authorized.length === 0)
    throw new Error("No device on USB. Plug the phone in (and check the cable carries data).");
  if (authorized.length > 1 && !process.env.ANDROID_SERIAL)
    throw new Error(`${authorized.length} devices attached - set ANDROID_SERIAL to pick one.`);
  // `adb devices` lists everything regardless of ANDROID_SERIAL; make sure a
  // chosen serial actually exists so later steps fail as "wrong serial", not
  // as a bogus "phone is offline".
  const serial = process.env.ANDROID_SERIAL;
  if (serial && !authorized.some((l) => l.startsWith(serial + "\t")))
    throw new Error(`ANDROID_SERIAL=${serial} is not an attached, authorized device. Attached: ${authorized.map((l) => l.split("\t")[0]).join(", ") || "none"}`);
  return serial ?? authorized[0].split("\t")[0];
});
if (failed) finish();

step("device has network", () => {
  const ping = adb(["shell", "ping -c1 -W3 1.1.1.1"]);
  if (ping.code !== 0) {
    const msg = "Phone has NO internet (Wi-Fi off or captive portal). An offline phone looks exactly like a hung app: endless spinner, then a blank screen. Reconnect Wi-Fi, or pass --allow-offline to smoke the offline behaviour deliberately.";
    if (!allowOffline) throw new Error(msg);
    return "OFFLINE - continuing because --allow-offline";
  }
  return "online";
});
if (failed) finish();

if (doInstall) {
  step("install release APK", () => {
    const r = adb(["install", "-r", APK]);
    if (!r.out.includes("Success")) throw new Error(r.out.trim() || "adb install failed");
    return "installed";
  });
  if (failed) finish();
}

step("app is installed", () => {
  const out = shell(`pm list packages ${PKG}`);
  if (!out.includes(`package:${PKG}`))
    throw new Error(`${PKG} is not installed. Run with --install (builds land at ${APK}).`);
  const ver = shell(`dumpsys package ${PKG} | grep versionName | head -1`).trim();
  return ver || "installed";
});
if (failed) finish();

step("cold start", () => {
  shell("logcat -c");
  shell(`am force-stop ${PKG}`);
  const r = shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  if (/No activities found|aborted/i.test(r)) throw new Error(`launch failed: ${r}`);
  return "launched";
});

step(`process alive and stable after ${BOOT_WAIT_S}s`, () => {
  sleep(BOOT_WAIT_S / 2);
  const pidEarly = shell(`pidof -s ${PKG}`);
  sleep(BOOT_WAIT_S / 2);
  const pidLate = shell(`pidof -s ${PKG}`);
  if (!pidLate) throw new Error("Process is not running - the app died during startup. See the logcat steps below for why.");
  if (pidEarly && pidEarly !== pidLate)
    throw new Error(`Pid changed ${pidEarly} -> ${pidLate}: the app is crash-looping.`);
  return `pid ${pidLate}`;
});

step("JS bundle booted", () => {
  const log = shell("logcat -d");
  if (!/ReactNativeJS.*Running "main"/.test(log))
    throw new Error('ReactNativeJS never logged Running "main" - the JS bundle did not start.');
});

step("no fatal signatures in logcat", () => {
  const log = shell("logcat -d");
  const fatal = log.split("\n").filter((l) =>
    /FATAL EXCEPTION|TurboModuleInteropUtils|UnsatisfiedLink|Unable to parse @ReactMethod/.test(l));
  if (fatal.length) throw new Error(`Fatal lines:\n${fatal.slice(0, 5).join("\n")}`);
});

step("no spurious session drop", () => {
  const log = shell("logcat -d");
  const drops = log.split("\n").filter((l) => l.includes("[auth] session dropped"));
  // "explicit-sign-out" would be the user's own tap; anything else during a
  // smoke run means the launch itself destroyed the session - the exact bug
  // users reported as "started a backup, an hour later it logged me out".
  const spurious = drops.filter((l) => !l.includes("explicit-sign-out"));
  if (spurious.length) throw new Error(spurious[0].trim());
});

step("app is the top resumed activity", () => {
  const top = shell("dumpsys activity activities | grep topResumedActivity | head -1");
  if (!top.includes(PKG)) throw new Error(`Top activity is not ${PKG}: ${top.trim() || "(none)"}`);
});

let uiState = null;
step(`UI reached a real state (within ${UI_TIMEOUT_S}s)`, () => {
  const deadline = Date.now() + UI_TIMEOUT_S * 1000;
  let lastTexts = [];
  for (;;) {
    lastTexts = dumpNodes().map((n) => n.text);
    const has = (t) => lastTexts.some((x) => x.includes(t));
    if (has("Files") && has("Backup") && has("Settings")) { uiState = "signed-in"; return "signed-in UI (tab bar)"; }
    if (has("Welcome back") || has("Sign in") || has("Continue with Google")) { uiState = "signed-out"; return "login screen"; }
    if (Date.now() > deadline) break;
    sleep(3);
  }
  throw new Error(
    `Neither the tab bar nor the login screen appeared. The process is alive but the UI is stuck ` +
    `(a blocked gate or an invisible overlay - both have happened). On-screen text found: ` +
    `${lastTexts.length ? lastTexts.slice(0, 10).join(" | ") : "(none - screen is blank)"}`);
});

// ---------- phase 2: feature flows ----------

console.log("\nfeature flows");

if (uiState !== "signed-in") {
  const why = uiState === "signed-out"
    ? "phone is signed out; log in on the device and rerun for feature coverage"
    : "boot did not reach a healthy UI";
  for (const f of ["Files list renders rows", "folder opens and backs out", "search opens and closes",
    "workspace switcher opens and closes", "Backup tab renders", "Settings shows the account card",
    "Profile opens and backs out", "returns to Files tab"]) skip(f, why);
  finish();
}

const H = screenHeight();

step("Files list renders rows", () => {
  // Any folder/file row means the listing painted; the filter chips alone
  // prove only the chrome. "All" chip + at least one node below the chip row.
  waitFor("All", { timeoutS: 20 });
  const rows = dumpNodes().filter((n) => n.cy > H * 0.16 && n.cy < H * 0.82 && n.text.length > 1);
  if (rows.length === 0) throw new Error("No list content under the filter chips - empty or unpainted listing.");
  return `${rows.length} visible row labels`;
});

let firstFolder = null;
step("folder opens and backs out", () => {
  // Prefer a row with an item-count subtitle pattern nearby; otherwise take
  // the first label row. Read-only: open, verify SOMETHING rendered, back out.
  const rows = dumpNodes().filter((n) => n.cy > H * 0.16 && n.cy < H * 0.80 && n.text.length > 1 && !/^(All|Docs|Images|Videos|Hidden)$/.test(n.text));
  if (!rows.length) throw new Error("No rows to open.");
  firstFolder = rows[0];
  tapNode(firstFolder);
  sleep(1.2);
  const inFolder = dumpNodes();
  if (!inFolder.length) throw new Error(`Opening "${firstFolder.text}" produced a blank screen.`);
  back();
  waitFor("All", { timeoutS: 10 });
  return `opened "${firstFolder.text}"`;
});

step("search opens and closes", () => {
  ensureApp(H);
  // The header search is an icon (no text): resolve it via content-desc.
  shell("uiautomator dump /sdcard/smoke-ui.xml >/dev/null 2>&1 || true");
  const xml = shell("cat /sdcard/smoke-ui.xml 2>/dev/null");
  const m = xml.match(/content-desc="Search"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!m) throw new Error('No element with content-desc "Search" in the header.');
  tapNode({ cx: (+m[1] + +m[3]) / 2, cy: (+m[2] + +m[4]) / 2 });
  const opened = appIsForeground() &&
    (dumpNodes().some((n) => /Search/i.test(n.text)) ||
      shell("dumpsys input_method | grep mInputShown").includes("true"));
  if (!opened) throw new Error("Search UI did not open.");
  backToFiles(H);
});

step("workspace switcher opens and closes", () => {
  ensureApp(H);
  // The workspace name sits in the header (top ~12% of the screen).
  const header = dumpNodes().find((n) => n.cy < H * 0.12 && n.text.length > 1 && !/Owner|Admin|Member/.test(n.text));
  if (!header) throw new Error("No workspace name in the header.");
  tapNode(header);
  const sheet = dumpNodes();
  const gotSheet = sheet.filter((n) => n.text.length > 1).length > 2;
  if (!gotSheet) throw new Error("Workspace switcher sheet did not open.");
  backToFiles(H);
  return `via "${header.text}"`;
});

step("Backup tab renders", () => {
  ensureApp(H);
  tapTab("Backup", H);
  // The engine screen always shows either the engine controls or the
  // photo-permission primer - both count as rendered.
  const texts = dumpNodes().map((n) => n.text);
  if (!texts.some((t) => /Backup|photo|Photos|engine|Start/i.test(t)))
    throw new Error(`Backup screen content missing. Saw: ${texts.slice(0, 8).join(" | ")}`);
});

// The account card is the sole tap target into Profile - no separate "Profile"
// row and no "Signed in as" label since the Settings-hub redesign (c27f0322).
// It carries a stable accessibilityLabel, resolved via content-desc like Search above.
function findAccountCard() {
  shell("uiautomator dump /sdcard/smoke-ui.xml >/dev/null 2>&1 || true");
  const xml = shell("cat /sdcard/smoke-ui.xml 2>/dev/null");
  const m = xml.match(/content-desc="Open your profile"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!m) throw new Error('No element with content-desc "Open your profile" on the Settings screen.');
  return { cx: (+m[1] + +m[3]) / 2, cy: (+m[2] + +m[4]) / 2 };
}

step("Settings shows the account card", () => {
  if (!appIsForeground()) ensureApp(H);
  tapTab("Settings", H);
  waitFor("My workspaces", { timeoutS: 10 });
  findAccountCard();
  const texts = dumpNodes().map((n) => n.text);
  for (const item of ["My workspaces", "Backup", "Notifications", "Appearance", "Security"]) {
    if (!texts.some((t) => t.includes(item))) throw new Error(`Settings row "${item}" missing.`);
  }
});

step("Profile opens and backs out", () => {
  if (!appIsForeground()) ensureApp(H);
  tapNode(findAccountCard());
  const texts = dumpNodes().map((n) => n.text);
  if (!texts.length) throw new Error("Profile screen is blank.");
  back();
  waitFor("My workspaces", { timeoutS: 10 });
});

step("returns to Files tab", () => {
  if (!appIsForeground()) ensureApp(H);
  tapTab("Files", H);
  waitFor("All", { timeoutS: 10 });
});

finish();

// ---------- evidence + summary ----------

function finish() {
  const dir = join(tmpdir(), "dosya-smoke");
  mkdirSync(dir, { recursive: true });
  const shot = join(dir, `smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  try {
    const png = spawnSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
    if (png.stdout?.length) writeFileSync(shot, png.stdout);
  } catch { /* screenshot is evidence, not a gate */ }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${failed ? "SMOKE FAILED" : "SMOKE PASSED"} - ${passed}/${results.length} checks`);
  console.log(`screenshot: ${shot}\n`);
  process.exit(failed ? 1 : 0);
}
