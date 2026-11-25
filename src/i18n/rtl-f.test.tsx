import type { ReactElement } from "react";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { screen } from "@testing-library/react-native";
import { renderInLocale, unflippedIcons, collectTexts } from "../../test-utils/i18n-sweep";
import { CoverageFigures } from "../backup/ui/CoverageFigures";
import { PhotoTile } from "../onboarding/ui/PhotoTile";
import { BackupTabIcon } from "../backup/ui/BackupTabIcon";

const EN_FIGURES = ["3", "Backed up", "2", "Pending", "Failed items", "1", "Failed"];
const root = join(__dirname, "../..");
const DIRS = ["files", "library", "backup", "onboarding", "activity", "notifications", "archive", "share", "theme"];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name) && name !== "ThemeSweep.tsx") out.push(rel);
  }
}

function owned(): string[] {
  const out: string[] = [];
  for (const d of DIRS) walk(join("src", d), out);
  return out;
}

describe("unit F source gate", () => {
  it("lists nothing unmarked", () => {
    const files = owned();
    expect(files.length).toBeGreaterThan(100);
    let failure = "";
    try {
      execFileSync("node", ["scripts/rtl-gate.mjs", "--check", ...files], { cwd: root, encoding: "utf8" });
    } catch (e) {
      failure = String((e as { stdout?: string }).stdout ?? e);
    }
    expect(failure).toBe("");
  });

  it("uses no banned logical-looking classes", () => {
    for (const f of owned()) {
      expect(readFileSync(join(root, f), "utf8")).not.toMatch(/\b(border-s|border-e|text-start|text-end)\b/);
    }
  });
});

describe("unit F screens", () => {
  const screens: [string, () => ReactElement][] = [
    ["CoverageFigures", () => <CoverageFigures uploaded={3} pending={2} failed={1} skipped={0} />],
    ["PhotoTile", () => <PhotoTile scene={0} done />],
    ["BackupTabIcon", () => <BackupTabIcon color="#000" size={20} />],
  ];
  for (const [name, make] of screens) {
    it(`${name} has no unflipped icon in ar`, async () => {
      await renderInLocale(make(), "ar");
      expect(unflippedIcons(screen.UNSAFE_root)).toEqual([]);
    });
  }

  it("CoverageFigures keeps its English texts", async () => {
    await renderInLocale(<CoverageFigures uploaded={3} pending={2} failed={1} skipped={0} />, "en");
    expect(collectTexts()).toEqual(EN_FIGURES);
  });
});
