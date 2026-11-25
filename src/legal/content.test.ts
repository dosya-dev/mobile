import { readFileSync } from "fs";
import { join } from "path";
import { TERMS_SECTIONS, PRIVACY_SECTIONS, type LegalSection } from "./content";

/**
 * The in-app legal text is a copy of the website's (see content.ts's header),
 * so the two can drift - and drifting on a factual claim about what the
 * product does is the kind that matters. The website dropped the promise to
 * scan file contents for malware and CSAM, because no scanning code exists
 * anywhere in the product; until this suite the app still shipped it.
 */

const REPO = join(__dirname, "..", "..", "..", "..");
const webTerms = () => readFileSync(join(REPO, "src", "pages", "terms-of-service.astro"), "utf8");
const webPrivacy = () => readFileSync(join(REPO, "src", "pages", "privacy-policy.astro"), "utf8");

const NO_SCANNING = "We do not scan the contents of your private files.";
const ACTS_ON_REPORTS = "We act on abuse reports and legal notices";

const textOf = (sections: LegalSection[]) => sections.flatMap((s) => s.paragraphs).join("\n");

describe("in-app legal copy makes no claim the product cannot keep", () => {
  const all = () => `${textOf(TERMS_SECTIONS)}\n${textOf(PRIVACY_SECTIONS)}`;

  it.each([
    ["automated content scanning", /automated tools to scan/i],
    ["malware scanning of stored files", /malware scanning/i],
    ["monitoring or reviewing user content", /monitor, review, or remove/i],
  ])("never promises %s", (_label, pattern) => {
    expect(all()).not.toMatch(pattern);
  });

  it("says plainly that private file contents are not scanned, in both documents", () => {
    expect(textOf(TERMS_SECTIONS)).toContain(NO_SCANNING);
    expect(textOf(PRIVACY_SECTIONS)).toContain(NO_SCANNING);
    expect(textOf(TERMS_SECTIONS)).toContain(ACTS_ON_REPORTS);
    expect(textOf(PRIVACY_SECTIONS)).toContain(ACTS_ON_REPORTS);
  });

  it("does not threaten to delete files or accounts for inactivity", () => {
    expect(textOf(TERMS_SECTIONS)).toContain("We do not currently delete accounts or files for inactivity.");
    expect(all()).not.toMatch(/scheduled for deletion/i);
    expect(all()).not.toMatch(/Extended periods of inactivity/i);
  });

  it("uses no em dashes", () => {
    expect(all()).not.toContain("—");
  });
});

describe("parity with the website's legal pages", () => {
  it("carries the same sentences the website now uses", () => {
    for (const web of [webTerms(), webPrivacy()]) {
      expect(web).toContain(NO_SCANNING);
      expect(web).toContain(ACTS_ON_REPORTS);
    }
    expect(webTerms()).toContain("We do not currently delete accounts or files for inactivity.");
  });

  it("keeps the website free of the claims the app just dropped", () => {
    const web = `${webTerms()}\n${webPrivacy()}`;
    expect(web).not.toMatch(/automated tools to scan/i);
    expect(web).not.toMatch(/malware scanning/i);
  });
});
