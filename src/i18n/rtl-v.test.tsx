import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { StyleSheet } from "react-native";
import { screen } from "@testing-library/react-native";
import { TocSheet } from "../reader/TocSheet";
import { ReaderMenu } from "../reader/ReaderMenu";
import { ViewerActions } from "../viewer/ViewerActions";
import { collectTexts, renderInLocale, unflippedIcons, type ReactTestInstance } from "../../test-utils/i18n-sweep";

const root = join(__dirname, "../..");

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.|\.generated\.|\.d\.ts$/.test(name)) out.push(rel);
  }
  return out;
}

// Every finding in the viewers is fixed or marked; anything unmarked fails the gate.
const RESERVED: string[] = [];

describe("viewers source gate", () => {
  it("has no unmarked physical token", () => {
    const files = [...walk("src/viewer", []), ...walk("src/reader", []), ...walk("src/player", []), "app/player.tsx", ...walk("app/file", [])];
    let out = "";
    try {
      out = execFileSync("node", ["scripts/rtl-gate.mjs", "--check", ...files], { cwd: root, encoding: "utf8" });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? "");
    }
    const found = out
      .split("\n")
      .filter(Boolean)
      .map((l) => l.replace(/\s+(->|\().*$/, ""));
    expect(found.sort()).toEqual([...RESERVED].sort());
  });
});

const tocProps = {
  visible: true,
  toc: [{ label: "Chapter 1", href: "c1", depth: 0 }, { label: "Part A", href: "c1a", depth: 1 }],
  bookmarks: [],
  onClose: jest.fn(),
  onSelectToc: jest.fn(),
  onSelectBookmark: jest.fn(),
  onRemoveBookmark: jest.fn(),
};
const menuProps = {
  visible: true,
  percent: 42,
  canSearch: true,
  canTheme: true,
  bookmarked: false,
  onClose: jest.fn(),
  onContents: jest.fn(),
  onSearch: jest.fn(),
  onThemes: jest.fn(),
  onShare: jest.fn(),
  onToggleBookmark: jest.fn(),
};
const actionProps = {
  availability: { save: true, link: true, star: true, versions: true, more: true },
  starred: false,
  handlers: { onDownload: jest.fn(), onLink: jest.fn(), onStar: jest.fn(), onVersions: jest.fn(), onMore: jest.fn() },
};

function styleOf(node: { props: Record<string, unknown> }) {
  return StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
}

describe("viewer screens in RTL", () => {
  it("TocSheet indents by paddingStart and flips its icons", async () => {
    await renderInLocale(<TocSheet {...tocProps} />, "ar");
    expect(unflippedIcons(screen.UNSAFE_root)).toEqual([]);
    const nested = screen.UNSAFE_root.findAll((n: ReactTestInstance) => n.props.style && styleOf(n).paddingStart === 32);
    expect(nested.length).toBeGreaterThan(0);
  });

  it("ReaderMenu pins its popover to the end edge", async () => {
    await renderInLocale(<ReaderMenu {...menuProps} />, "ar");
    expect(unflippedIcons(screen.UNSAFE_root)).toEqual([]);
    const pop = screen.UNSAFE_root.findAll((n: ReactTestInstance) => n.props.style && styleOf(n).width === 258);
    expect(pop.length).toBeGreaterThan(0);
    for (const n of pop) {
      expect(styleOf(n).end).toBe(16);
      expect(styleOf(n).right).toBeUndefined();
    }
  });

  it("ViewerActions has no unflipped icon", async () => {
    await renderInLocale(<ViewerActions {...actionProps} />, "ar");
    expect(unflippedIcons(screen.UNSAFE_root)).toEqual([]);
  });
});

describe("viewer screens in English are unchanged", () => {
  it("TocSheet", async () => {
    await renderInLocale(<TocSheet {...tocProps} />, "en");
    expect(collectTexts(screen.toJSON() as never)).toEqual(["Contents", "Bookmarks", "Chapter 1", "Part A"]);
  });
  it("ReaderMenu", async () => {
    await renderInLocale(<ReaderMenu {...menuProps} />, "en");
    expect(collectTexts(screen.toJSON() as never)).toEqual(["Close menu", "Contents", "Contents", "42", "%", "Search", "Search", "Themes & Settings", "Themes & Settings", "Share", "Bookmark"]);
  });
  it("ViewerActions", async () => {
    await renderInLocale(<ViewerActions {...actionProps} />, "en");
    expect(collectTexts(screen.toJSON() as never)).toEqual(["Download", "Download", "Link", "Link", "Star", "Star", "Versions", "Versions", "More", "More"]);
  });
});
