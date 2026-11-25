/**
 * The RTL source gate (scripts/rtl-gate.mjs): the physical-direction scanner,
 * the fixer and the ratchet over app/ and src/. The script is a plain ESM
 * module, so it runs in node through execFileSync, as vendor-script.test.ts
 * does for vendor-i18n.mjs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const mobileRoot = resolve(__dirname, "../..");
const script = resolve(mobileRoot, "scripts/rtl-gate.mjs");

interface Finding {
  line: number;
  token: string;
  kind: "class" | "style";
  fix?: string;
  reason?: string;
}

function node(code: string): unknown {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

function scan(text: string, file = "a.tsx"): Finding[] {
  return node(`
    import { scanSource } from ${JSON.stringify(script)};
    process.stdout.write(JSON.stringify(scanSource(${JSON.stringify(text)}, ${JSON.stringify(file)})));
  `) as Finding[];
}

function cli(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [script, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: err.stdout + err.stderr };
  }
}

function tmpFile(text: string, name = "a.tsx"): string {
  const dir = mkdtempSync(join(tmpdir(), "rtl-gate-"));
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
}

describe("mapping table (class names)", () => {
  it.each([
    ["ml-2", "ms-2"],
    ["mr-4", "me-4"],
    ["pl-3", "ps-3"],
    ["pr-3", "pe-3"],
    ["left-0", "start-0"],
    ["right-2", "end-2"],
    ["rounded-l-lg", "rounded-s-lg"],
    ["rounded-r", "rounded-e"],
    ["rounded-tl-xl", "rounded-ss-xl"],
    ["rounded-tr-xl", "rounded-se-xl"],
    ["rounded-bl-xl", "rounded-es-xl"],
    ["rounded-br-xl", "rounded-ee-xl"],
    ["active:ml-2", "active:ms-2"],
    ["dark:active:pr-1", "dark:active:pe-1"],
    ["-mr-1.5", "-me-1.5"],
    ["!pl-2", "!ps-2"],
    ["pl-[50px]", "ps-[50px]"],
    ["right-[10%]", "end-[10%]"],
  ])("%s -> %s", (from, to) => {
    const f = scan(`export const A = () => <View className="${from}" />;\n`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ line: 1, token: from, kind: "class", fix: to });
  });

  it("scans template literals and string concatenation", () => {
    const f = scan(
      [
        "const a = `flex ${on ? 'ml-2' : ''} p-2`;",
        'const b = "flex px-3" + (on ? " border-l border-border" : "");',
      ].join("\n"),
    );
    expect(f.map((x) => x.token)).toEqual(["ml-2", "border-l"]);
  });

  it("does not treat locale tags or prose as classes", () => {
    expect(scan('const l = "pl-PL"; const m = "mr-ee";\n')).toEqual([]);
  });
});

describe("style keys", () => {
  it.each([
    ["marginLeft", "marginStart"],
    ["marginRight", "marginEnd"],
    ["paddingLeft", "paddingStart"],
    ["paddingRight", "paddingEnd"],
    ["borderLeftWidth", "borderStartWidth"],
    ["borderRightColor", "borderEndColor"],
    ["borderTopLeftRadius", "borderTopStartRadius"],
    ["borderTopRightRadius", "borderTopEndRadius"],
    ["borderBottomLeftRadius", "borderBottomStartRadius"],
    ["borderBottomRightRadius", "borderBottomEndRadius"],
  ])("%s -> %s", (from, to) => {
    const f = scan(`const A = <View style={{ ${from}: 4 }} />;\n`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "style", token: from, fix: to });
  });

  it("converts a lone left or right, allows equal pairs and hitSlop", () => {
    expect(scan("const s = <View style={{ position: 'absolute', left: 0, top: 0 }} />;\n")[0]).toMatchObject({ token: "left", fix: "start" });
    expect(scan("const s = <View style={{ right: 8 }} />;\n")[0]).toMatchObject({ token: "right", fix: "end" });
    expect(scan("const s = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };\n")).toEqual([]);
    expect(scan("const s = {\n  top: 0,\n  left: 4,\n  right: 4,\n};\n")).toEqual([]);
    expect(scan("const s = <View style={{ left: 0, right: 8 }} />;\n")).toHaveLength(2);
    expect(scan("<Pressable hitSlop={{ left: 8, top: 4 }} />\n")).toEqual([]);
    expect(scan("<Pressable pressRetentionOffset={{ right: 20 }} />\n")).toEqual([]);
  });

  it("renames keys only inside style contexts", () => {
    const fixed = (src: string) => {
      const p = tmpFile(src);
      cli(["--fix", p]);
      return readFileSync(p, "utf8");
    };
    expect(fixed("<View style={{ marginLeft: 4 }} />\n")).toBe("<View style={{ marginStart: 4 }} />\n");
    expect(fixed("<View style={[a, on && { left: 3 }]} />\n")).toBe("<View style={[a, on && { start: 3 }]} />\n");
    expect(fixed("const styles = StyleSheet.create({\n  row: { paddingRight: 2 },\n});\n")).toBe(
      "const styles = StyleSheet.create({\n  row: { paddingEnd: 2 },\n});\n",
    );
    expect(fixed("const cardStyle = { right: 1 };\n")).toBe("const cardStyle = { end: 1 };\n");
    expect(fixed("const s: ViewStyle = { left: 1 };\n")).toBe("const s: ViewStyle = { start: 1 };\n");
  });

  it("reports but never renames a key in a non-style object", () => {
    for (const src of [
      "const hit = { left: 10, top: 2 };\n",
      'const labels = { left: "Left", right: "Right" };\n',
      "const p = { left: pt.x, top: pt.y };\n",
      "const m = { marginLeft: 4 };\n",
    ]) {
      const f = scan(src);
      expect(f.length).toBeGreaterThan(0);
      expect(f.every((x) => x.fix === undefined && x.reason)).toBe(true);
      const p = tmpFile(src);
      cli(["--fix", p]);
      expect(readFileSync(p, "utf8")).toBe(src);
    }
  });

  it("ignores type annotations", () => {
    expect(scan("type R = { left: number; right: number };\n")).toEqual([]);
  });

  it("allows text-left, text-right and textAlign left/right", () => {
    expect(scan('<Text className="text-left" style={{ textAlign: "right" }} />\n')).toEqual([]);
  });

  it("allows symmetric class pairs, inset-x, px and mx", () => {
    expect(scan('<View className="absolute left-0 right-0 inset-x-2 px-3 mx-auto" />\n')).toEqual([]);
  });
});

describe("reported, never fixed", () => {
  it("border-l and border-r have no fix", () => {
    const f = scan('<View className="border-l border-border border-r-2" />\n');
    expect(f.map((x) => x.token)).toEqual(["border-l", "border-r-2"]);
    expect(f.every((x) => x.fix === undefined && x.reason)).toBe(true);
    expect(f[0].reason).toMatch(/borderStartWidth/);
  });

  it("bans border-s, border-e, text-start and text-end", () => {
    const f = scan('<View className="border-s-2 border-e text-start text-end border-solid" />\n');
    expect(f.map((x) => x.token)).toEqual(["border-s-2", "border-e", "text-start", "text-end"]);
    expect(f.every((x) => x.fix === undefined && /banned/.test(x.reason ?? ""))).toBe(true);
  });

  it.each([
    "translateX",
    "scaleX",
    "locationX",
    "pageX",
    "contentOffset.x",
  ])("reports %s", (word) => {
    const f = scan(`const v = ev.${word};\n`);
    expect(f).toHaveLength(1);
    expect(f[0].fix).toBeUndefined();
  });

  it("reports translate-x classes, skips the centering pair", () => {
    expect(scan('<View className="-translate-x-2" />\n')).toHaveLength(1);
    expect(scan('<View className="absolute left-1/2 -translate-x-1/2" />\n')).toEqual([]);
    expect(scan('<View className="absolute -translate-x-1/2 right-1/2" />\n')).toEqual([]);
    // left-1/2 alone is an ordinary inset
    expect(scan('<View className="absolute left-1/2" />\n')[0]).toMatchObject({ fix: "start-1/2" });
  });

  it("reports SVG x, cx and d attributes only in files that use react-native-svg", () => {
    const svg = 'import { Circle, Path } from "react-native-svg";\nconst A = <><Circle cx={10} /><Path d="M0 0" /></>;\n';
    expect(scan(svg).map((x) => x.token)).toEqual(["cx", "d"]);
    expect(scan('const A = <Thing d="x" cx={1} />;\n')).toEqual([]);
  });
});

describe("rtl-ok markers", () => {
  it("passes on the line or the line above with an allowed reason", () => {
    expect(scan('<View className="ml-2" /> // rtl-ok: media timeline\n')).toEqual([]);
    expect(scan('// rtl-ok: book art\n<View className="ml-2" />\n')).toEqual([]);
  });

  it("fails on an unknown or empty reason", () => {
    expect(scan('<View className="ml-2" /> // rtl-ok: because\n').length).toBeGreaterThan(0);
    expect(scan('<View className="ml-2" /> // rtl-ok:\n').length).toBeGreaterThan(0);
  });
});

describe("CLI", () => {
  it("--check exits 1 and names file and line for an unmarked finding", () => {
    const p = tmpFile('const x = 1;\nexport const A = () => <View className="ml-2" />;\n');
    const r = cli(["--check", p]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${p}:2`);
    expect(r.out).toContain("ml-2");
  });

  it("--check exits 0 for a clean file and a marked one", () => {
    expect(cli(["--check", tmpFile('<View className="ms-2 text-left" />\n')]).code).toBe(0);
    expect(cli(["--check", tmpFile('<View className="ml-2" /> // rtl-ok: map\n')]).code).toBe(0);
  });

  it("--fix applies pure renames, prints the rest, and is idempotent", () => {
    const src = [
      'const a = <View className="ml-2 active:pr-3 border-l left-0" style={{ paddingLeft: 4 }} />;',
      'const b = "x" + (on ? " rounded-tl-lg" : "");',
      "",
    ].join("\n");
    const p = tmpFile(src);
    const first = cli(["--fix", p]);
    expect(first.code).toBe(0);
    expect(first.out).toContain("border-l");
    const fixed = readFileSync(p, "utf8");
    expect(fixed).toBe(
      [
        'const a = <View className="ms-2 active:pe-3 border-l start-0" style={{ paddingStart: 4 }} />;',
        'const b = "x" + (on ? " rounded-ss-lg" : "");',
        "",
      ].join("\n"),
    );
    cli(["--fix", p]);
    expect(readFileSync(p, "utf8")).toBe(fixed);
  });
});

describe("whole tree", () => {
  const found = node(`
    import { scanTree } from ${JSON.stringify(script)};
    process.stdout.write(JSON.stringify(scanTree(${JSON.stringify(mobileRoot)})));
  `) as Record<string, Finding[]>;

  it("has no unmarked physical-direction finding in app/ or src/", () => {
    const list = Object.entries(found).flatMap(([file, fs]) => fs.map((f) => `${file}:${f.line} ${f.token}`));
    expect(list).toEqual([]);
  });

  it("probe files and tests are not scanned, and the probes are gone", () => {
    expect(Object.keys(found).filter((f) => /rtl-probe|\.test\./.test(f))).toEqual([]);
    expect(existsSync(join(mobileRoot, "src/i18n/rtl-probe.tsx"))).toBe(false);
    expect(existsSync(join(mobileRoot, "app/__rtl-probe.tsx"))).toBe(false);
    expect(existsSync(join(mobileRoot, "src/i18n/rtl-ratchet.json"))).toBe(false);
  });

  it("lists every rtl-ok line with its reason (for the reviewer)", () => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
          readFileSync(p, "utf8").split("\n").forEach((l, i) => {
            const m = /rtl-ok:\s*(.*)$/.exec(l);
            if (m) out.push(`${p.slice(mobileRoot.length + 1)}:${i + 1} ${m[1].replace(/\s*\*\/\}?\s*$/, "")}`);
          });
        }
      }
    };
    walk(join(mobileRoot, "app"));
    walk(join(mobileRoot, "src"));
    console.log(`rtl-ok lines (${out.length}):\n${out.join("\n")}`);
    expect(out.length).toBeGreaterThan(0);
  });
});
