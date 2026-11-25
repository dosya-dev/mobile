import { filledSegments, groupRecoveryKey, isAcceptable, strengthOf, wordCount } from "./passphraseStrength";

describe("strengthOf", () => {
  it("says nothing about an empty field", () => {
    expect(strengthOf("")).toBe("empty");
  });

  it("calls anything under eight characters too short", () => {
    expect(strengthOf("abc1234")).toBe("tooShort");
  });

  it("calls a short single word weak, even with a symbol in it", () => {
    expect(strengthOf("P@ssw0rd!")).toBe("weak");
  });

  it("calls twelve characters good", () => {
    expect(strengthOf("abcdefghijkl")).toBe("good");
  });

  // The advice on screen is four random words, so four words is enough for
  // good whatever their length, and long enough words make it strong.
  it("rewards four words", () => {
    expect(strengthOf("a1 b2 c3 d4")).toBe("good");
    expect(strengthOf("maple orbit candle river")).toBe("strong");
  });

  it("calls a long run of characters strong without any words", () => {
    expect(strengthOf("x".repeat(20))).toBe("strong");
  });

  it("counts characters, not UTF-16 units", () => {
    // Seven emoji are fourteen code units but seven characters.
    expect(strengthOf("🔒🔒🔒🔒🔒🔒🔒")).toBe("tooShort");
  });
});

describe("the rest", () => {
  it("fills one segment per step", () => {
    expect([ "empty", "tooShort", "weak", "good", "strong" ].map((s) => filledSegments(s as never))).toEqual([0, 1, 2, 3, 4]);
  });

  it("only refuses a passphrase under the minimum", () => {
    expect(isAcceptable("1234567")).toBe(false);
    expect(isAcceptable("12345678")).toBe(true);
  });

  it("ignores one-letter fragments when counting words", () => {
    expect(wordCount("a b c d")).toBe(0);
    expect(wordCount("  maple   orbit ")).toBe(2);
  });

  it("groups the recovery key in fours and drops any spacing", () => {
    expect(groupRecoveryKey("3f9a1c7e8b")).toEqual(["3f9a", "1c7e", "8b"]);
    expect(groupRecoveryKey("4f2a 91bc")).toEqual(["4f2a", "91bc"]);
  });
});
