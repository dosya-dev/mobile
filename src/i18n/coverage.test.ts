/**
 * The mobile i18n coverage gate (Task 10).
 *
 * Reads the catalog (packages/i18n/mobile), the vendored output (src/i18n) and
 * the app source (app/ and src/) and fails when they drift apart:
 *  a. a translatable catalog key no code names (dead string),
 *  b. a literal t("...") key the catalog lacks,
 *  c. a shipped language that misses a key or breaks arguments / plural categories,
 *  d. t() / translateExternal() / richText() running at module load, or in a useState initialiser,
 *  e. a catalog source with entities, **, doubled spaces, '{ or $ in braces,
 *  f. src/i18n generated files that differ from what vendor:i18n computes now,
 *  g. an RTL locale in LOCALES,
 *  h. messages/en.json out of step with the catalog sources,
 *  i. the vendored runtime differing from apps/desktop/src/i18n.
 * The whole file is skipped when the monorepo catalog folder is absent
 * (apps/mobile built alone).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { parseIcu, type IcuNode } from "./icu";
import { LOCALES, RTL_LOCALES } from "./locales";
import shipped from "./shipped.json";

const mobileRoot = resolve(__dirname, "../..");
const desktopRoot = resolve(mobileRoot, "../desktop");
const catalogDir = resolve(mobileRoot, "../../packages/i18n/mobile");
const script = resolve(mobileRoot, "scripts/vendor-i18n.mjs");
const inMonorepo = existsSync(catalogDir) && existsSync(desktopRoot);
const maybe = inMonorepo ? describe : describe.skip;

type Entry = { key: string; source: string; translate?: boolean };
const catalog: Entry[] = inMonorepo
  ? JSON.parse(readFileSync(join(catalogDir, "en.catalog.json"), "utf8"))
      .strings
  : [];
const translatable = catalog.filter((e) => e.translate !== false);
const catalogKeys = new Set(catalog.map((e) => e.key));

// ---------------------------------------------------------------------------
// Source scan (TypeScript AST: comments never count, string literals do)
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const SOURCE_FILE = /\.(ts|tsx)$/;
const NOT_SOURCE = /(\.test\.|\.d\.ts$|\.generated\.)/;

function appFiles(): string[] {
  return [
    ...walk(join(mobileRoot, "app")),
    ...walk(join(mobileRoot, "src")),
  ].filter((f) => {
    const rel = relative(mobileRoot, f).split("\\").join("/");
    if (!SOURCE_FILE.test(f) || NOT_SOURCE.test(f)) return false;
    // The generated catalog output and the sweeps/fixtures are not call sites.
    if (
      rel.startsWith("src/i18n/messages/") ||
      rel === "src/i18n/keys.ts" ||
      rel.startsWith("src/i18n/sweeps/")
    )
      return false;
    return true;
  });
}

const KEY_SHAPE = /^[a-z][a-z0-9-]*\.[a-z]+\.[A-Za-z0-9]+$/;
// Functions that take a catalog key as the first argument.
const KEY_CALLEES = new Set(["t", "moduleT", "tr", "translate", "tt"]);
const LOAD_TIME_CALLEES = new Set([
  ...KEY_CALLEES,
  "translateExternal",
  "richText",
]);

interface Scan {
  literals: Set<string>; // every string literal / no-substitution template in the app
  callKeys: { key: string; where: string }[]; // literal first args of t(...) style calls
  moduleLoad: string[]; // translation calls running when the module loads
  useStateCalls: string[]; // useState initialisers that translate
}

function calleeName(call: ts.CallExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

function isFunctionLike(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n) ||
    // class field initialisers run per instance, not at module load
    ts.isPropertyDeclaration(n)
  );
}

function scanSource(): Scan {
  const scan: Scan = {
    literals: new Set(),
    callKeys: [],
    moduleLoad: [],
    useStateCalls: [],
  };
  for (const file of appFiles()) {
    const rel = relative(mobileRoot, file);
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.ES2020,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const where = (n: ts.Node) =>
      `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const visit = (n: ts.Node, inFunction: boolean) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
        scan.literals.add(n.text);
      if (ts.isCallExpression(n)) {
        const name = calleeName(n);
        const first = n.arguments[0];
        if (
          name &&
          KEY_CALLEES.has(name) &&
          first &&
          (ts.isStringLiteral(first) ||
            ts.isNoSubstitutionTemplateLiteral(first)) &&
          KEY_SHAPE.test(first.text)
        ) {
          scan.callKeys.push({ key: first.text, where: where(n) });
        }
        if (name && LOAD_TIME_CALLEES.has(name) && !inFunction)
          scan.moduleLoad.push(`${where(n)} ${name}(`);
        if (name === "useState" && n.arguments.length) {
          let translates = false;
          const find = (c: ts.Node) => {
            if (ts.isCallExpression(c)) {
              const cn = calleeName(c);
              if (cn && LOAD_TIME_CALLEES.has(cn)) translates = true;
            }
            ts.forEachChild(c, find);
          };
          find(n.arguments[0]);
          if (translates) scan.useStateCalls.push(where(n));
        }
      }
      const next = inFunction || isFunctionLike(n);
      ts.forEachChild(n, (c) => visit(c, next));
    };
    visit(sf, false);
  }
  return scan;
}

/**
 * Catalog keys with no string literal in app/ or src/. Every one is text that
 * native code shows (widgets, the Files extension, permission prompts): the
 * catalog holds it so translators see it, and the native task group (Tasks 13
 * to 15) generates the .strings / strings.xml files from it. Exact keys, one
 * reason per group; a key that gains a JS use must leave this list.
 */
const NOT_NAMED_BY_LITERAL_GROUPS = {
  widget: {
    reason:
      "Backup widget, Live Activity, Android foreground service and widget resources: native code, wired by Tasks 13 and 14.",
    keys: [
      "backup.description.backupStatusAndStorageForYourDosyaWorkspace",
      "backup.description.openDosyaToSeeYourBackup",
      "backup.description.showsProgressWhileYourPhotosAreBackingUp",
      "backup.description.statusStorageLastBackupAndSpeedThemedLikeYourApp",
      "backup.heading.backupStatus",
      "backup.heading.dosyaBackup",
      "backup.label.backupChannel",
      "backup.label.free",
      "backup.label.freeInBackup",
      "backup.label.lastBackup",
      "backup.label.lastSpeed",
      "backup.label.progress",
      "backup.label.speedNow",
      "backup.label.todayTime",
      "backup.label.used",
      "backup.label.usedInBackup",
      "backup.status.backingUpToWorkspaceName",
      "sync.label.bpsS",
    ],
  },
  files: {
    reason:
      "iOS Files extension and Android document provider text: native code, wired by the native task group (Tasks 13 and 14).",
    keys: [
      "native-files.error.chooseAWorkspaceItemsCanTBeAddedNextToYourWorkspaces",
      "native-files.error.couldNotPlaceDownload",
      "native-files.error.dosyaDevCanTStorePackagesOrLinksCompressItToAZipFirst",
      "native-files.error.dosyaDevIsUnreachable",
      "native-files.error.everyNameFromNameToIts20thCopyIsTaken",
      "native-files.error.fileIdIsInTheTrash",
      "native-files.error.folderIdIsInTheTrash",
      "native-files.error.folderNamesOnDosyaDevCanTContainOr",
      "native-files.error.movingBetweenWorkspacesIsnTSupportedYetCopyItInstead",
      "native-files.error.movingBetweenWorkspacesIsnTSupportedYetCopyTheFileInstead",
      "native-files.error.movingBetweenWorkspacesIsnTSupportedYetCopyTheFolderInstead",
      "native-files.error.nameIsLockedOpenItInTheDosyaDevApp",
      "native-files.error.notAFileDocumentId",
      "native-files.error.notAFolder",
      "native-files.error.notAFolderDocumentId",
      "native-files.error.openTheDosyaDevAppToSignIn",
      "native-files.error.unknownDocumentId",
      "native-files.error.workspaceId",
      "native-files.error.workspacesCanBeCreatedOnlyInTheDosyaDevApp",
      "native-files.error.workspacesCanBeDeletedOnlyInTheDosyaDevApp",
      "native-files.error.workspacesCanBeRenamedOrRemovedOnlyInTheDosyaDevApp",
      "native-files.label.filePickerUploads",
      "native-files.label.nameWasNotSavedToDosyaDev",
      "native-files.label.openTheDosyaDevAppToSignIn",
      "native-files.label.theUploadFailedSaveItAgainFromTheApp",
    ],
  },
  purpose: {
    reason:
      "iOS permission (purpose) strings and the Siri intent description: app.config.ts / withSiriPlayIntent.js, wired by Task 13 through InfoPlist.strings.",
    keys: [
      "onboarding.description.document",
      "onboarding.description.dosyaDevNeedsAccessToYourContactsToBackThemUpToYourDosya",
      "onboarding.description.dosyaDevNeedsAccessToYourPhotoLibraryToBackUpThePhotosAnd",
      "onboarding.description.dosyaDevSavesToYourPhotoLibraryWhenYouRestoreABackedUpPhoto",
      "onboarding.description.dosyaDevUsesFaceIDToUnlockTheAppWithoutTypingYourPasswordFor",
      "onboarding.description.dosyaDevUsesTheCameraToTakeAPhotoAndUploadItStraightTo",
      "onboarding.description.usedToPlayYourFilesByVoiceIncludingInCarPlay",
    ],
  },
  upload: {
    reason:
      "iOS background-upload module reason text (BackgroundUploadSession.swift): native, never shown as such; the app maps its reason codes to other keys.",
    keys: [
      "backup.error.invalidJobMissingHeaders",
      "backup.error.invalidJobMissingPath",
      "backup.error.invalidJobUnusableUrl",
      "backup.error.taskMissingAfterRelaunch",
    ],
  },
};

const NOT_NAMED_BY_LITERAL: Record<string, string> = Object.fromEntries(
  Object.values(NOT_NAMED_BY_LITERAL_GROUPS).flatMap((g) =>
    g.keys.map((k) => [k, g.reason]),
  ),
);

// ---------------------------------------------------------------------------

maybe("mobile i18n coverage gate", () => {
  let scan: Scan;
  beforeAll(() => {
    scan = scanSource();
  });

  it("a. every translatable catalog key appears as a string literal in app/ or src/ (or is allow-listed with a reason)", () => {
    const unused = translatable
      .map((e) => e.key)
      .filter((k) => !scan.literals.has(k) && !(k in NOT_NAMED_BY_LITERAL));
    expect(unused).toEqual([]);
    expect(Object.keys(NOT_NAMED_BY_LITERAL)).toHaveLength(54);
    for (const [k, reason] of Object.entries(NOT_NAMED_BY_LITERAL)) {
      expect(catalogKeys.has(k)).toBe(true); // a stale allow-list entry is a bug
      expect(reason.length).toBeGreaterThan(10);
      expect(scan.literals.has(k)).toBe(false); // allow-list only what a literal cannot cover
    }
  });

  it('b. every literal t("...") key exists in the catalog', () => {
    expect(scan.callKeys.length).toBeGreaterThan(1000); // the scan is really looking
    const missing = scan.callKeys
      .filter((c) => !catalogKeys.has(c.key))
      .map((c) => `${c.where} ${c.key}`);
    expect(missing).toEqual([]);
  });

  describe("c. every shipped language is complete and well formed", () => {
    const english: Record<string, string> = Object.fromEntries(
      catalog.map((e) => [e.key, e.source]),
    );
    const names = (nodes: IcuNode[], out = new Set<string>()): Set<string> => {
      for (const n of nodes) {
        if (typeof n === "string" || n.type === "pound") continue;
        out.add(n.name);
        if (n.type === "plural" || n.type === "select")
          for (const o of Object.values(n.options)) names(o, out);
      }
      return out;
    };
    const branches = (nodes: IcuNode[], out: string[] = []): string[] => {
      for (const n of nodes) {
        if (typeof n === "string" || n.type === "pound" || n.type === "arg")
          continue;
        if (n.type === "plural") out.push(...Object.keys(n.options));
        for (const o of Object.values(n.options)) branches(o, out);
      }
      return out;
    };

    it("ships at least the 26 languages of Task 8 and the list is the vendored one", () => {
      expect(shipped.length).toBeGreaterThanOrEqual(26);
      expect([...LOCALES].filter((l) => l !== "en")).toEqual(shipped);
    });

    it.each(shipped)(
      "%s: every translatable key, matching arguments, valid plural categories, reuse keys included",
      (lang) => {
        const messages: Record<string, string> = JSON.parse(
          readFileSync(join(catalogDir, `${lang}.json`), "utf8"),
        );
        const problems: string[] = [];
        const allowed = new Set([
          ...new Intl.PluralRules(lang).resolvedOptions().pluralCategories,
          "other",
        ]);
        for (const e of translatable) {
          const text = messages[e.key];
          if (text === undefined) {
            problems.push(`${e.key}: missing`);
            continue;
          }
          let nodes: IcuNode[];
          try {
            nodes = parseIcu(text);
          } catch {
            problems.push(`${e.key}: does not parse`);
            continue;
          }
          const want = [...names(parseIcu(english[e.key]))].sort().join(",");
          const have = [...names(nodes)].sort().join(",");
          if (want !== have)
            problems.push(`${e.key}: arguments {${have}} vs English {${want}}`);
          const bad = branches(nodes).find(
            (b) => !allowed.has(b) && !/^=\d+$/.test(b),
          );
          if (bad)
            problems.push(
              `${e.key}: plural branch "${bad}" not used by ${lang}`,
            );
        }
        expect(problems).toEqual([]);
      },
    );

    it("the vendored language files hold exactly the translatable keys (nothing stale)", () => {
      const want = translatable.map((e) => e.key).sort();
      for (const lang of shipped) {
        const vendored = Object.keys(
          JSON.parse(
            readFileSync(
              join(mobileRoot, "src/i18n/messages", `${lang}.json`),
              "utf8",
            ),
          ),
        ).sort();
        expect(`${lang} ${vendored.length}`).toBe(`${lang} ${want.length}`);
        expect(vendored).toEqual(want);
      }
    });
  });

  it("d. no translation call runs at module load and no useState initialiser translates", () => {
    expect(scan.moduleLoad).toEqual([]);
    expect(scan.useStateCalls).toEqual([]);
  });

  it("e. catalog sources hold no entities, **, doubled spaces, '{ or $ inside braces", () => {
    const bad: string[] = [];
    for (const e of catalog) {
      const s = e.source;
      if (/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/.test(s))
        bad.push(`${e.key}: entity`);
      if (s.includes("**")) bad.push(`${e.key}: **`);
      if (/ {2,}/.test(s)) bad.push(`${e.key}: doubled space`);
      if (s.includes("'{")) bad.push(`${e.key}: '{`);
      if (/\{[^{}]*\$[^{}]*\}/.test(s) || s.includes("$}"))
        bad.push(`${e.key}: $ inside braces`);
    }
    expect(bad).toEqual([]);
  });

  describe("vendored output", () => {
    // The script is plain ESM (import.meta, top-level await): run it in node, not through babel.
    const outputs = (() => {
      let cached: {
        files: Record<string, string>;
        skipped: Record<string, string[]>;
        shipped: string[];
      } | null = null;
      return () => {
        if (!cached) {
          const code = `
            import { buildOutputs } from ${JSON.stringify(script)};
            const r = await buildOutputs(${JSON.stringify({ mobileRoot, desktopRoot, catalogDir, allowDrop: [] })});
            process.stdout.write(JSON.stringify({ files: r.files, skipped: r.skipped, shipped: r.shipped }));
          `;
          cached = JSON.parse(
            execFileSync(
              process.execPath,
              ["--input-type=module", "-e", code],
              { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
            ),
          );
        }
        return cached!;
      };
    })();

    it("f. shipped.json is what buildOutputs() computes now, and no language left it", () => {
      const r = outputs(); // throws when a previously shipped language would drop
      expect(
        JSON.parse(
          readFileSync(join(mobileRoot, "src/i18n/shipped.json"), "utf8"),
        ),
      ).toEqual(r.shipped);
      expect(r.shipped).toEqual(shipped);
    });

    it("f. every generated file on disk equals the freshly computed one", () => {
      const r = outputs();
      const stale: string[] = [];
      for (const [rel, content] of Object.entries(r.files)) {
        const p = join(mobileRoot, rel);
        if (!existsSync(p) || readFileSync(p, "utf8") !== content)
          stale.push(rel);
      }
      expect(stale).toEqual([]);
      // and no extra language file lingers
      const onDisk = readdirSync(join(mobileRoot, "src/i18n/messages"))
        .map((f) => `src/i18n/messages/${f}`)
        .sort();
      expect(onDisk).toEqual(
        Object.keys(r.files)
          .filter((f) => f.startsWith("src/i18n/messages/"))
          .sort(),
      );
    });

    it("g. the RTL locales in LOCALES are exactly RTL_LOCALES", () => {
      const inLocales = (LOCALES as readonly string[]).filter((l) =>
        ["ar", "he", "fa", "ur"].includes(l),
      );
      expect(inLocales).toEqual([...RTL_LOCALES]);
      expect(inLocales).not.toContain("ur");
    });

    it("g2. no value in ar, he or fa contains a bidi control character", () => {
      const bidi = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
      for (const l of ["ar", "he", "fa"]) {
        const m = JSON.parse(
          readFileSync(join(mobileRoot, `src/i18n/messages/${l}.json`), "utf8"),
        ) as Record<string, string>;
        const bad = Object.entries(m).filter(([, v]) => bidi.test(v)).map(([k]) => k);
        expect(bad).toEqual([]);
      }
    });

    it("h. messages/en.json equals the catalog sources", () => {
      const en = JSON.parse(
        readFileSync(join(mobileRoot, "src/i18n/messages/en.json"), "utf8"),
      );
      expect(en).toEqual(
        Object.fromEntries(catalog.map((e) => [e.key, e.source])),
      );
    });

    it("i. the vendored runtime is byte-equal to apps/desktop/src/i18n", () => {
      for (const f of ["icu.ts", "translator.ts", "match.ts"]) {
        expect(
          readFileSync(join(mobileRoot, "src/i18n", f), "utf8") ===
            readFileSync(join(desktopRoot, "src/i18n", f), "utf8"),
        ).toBe(true);
      }
    });
  });
});
