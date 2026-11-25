/**
 * How strong a new Vault passphrase looks, for the meter under the field.
 *
 * Length is what matters, so length is what this scores, with a word count
 * standing in for the "four random words" advice. Deliberately NO composition
 * rules: the shared password policy (apps/web validation-policy) drops them
 * for the same reason NIST SP 800-63B does - forcing a digit and a symbol
 * pushes people to short mangled strings and rejects "maple orbit candle
 * river", which is the passphrase we want.
 *
 * This is guidance, not a guess at entropy. The only hard rule is MIN_LENGTH,
 * the same lower bound the account password uses.
 */
export const MIN_LENGTH = 8;
export const GOOD_LENGTH = 12;
export const STRONG_LENGTH = 16;
export const GOOD_WORDS = 4;

export type Strength = "empty" | "tooShort" | "weak" | "good" | "strong";

export function wordCount(passphrase: string): number {
  return passphrase.trim().split(/\s+/u).filter((w) => w.length >= 2).length;
}

export function strengthOf(passphrase: string): Strength {
  const length = [...passphrase].length;
  if (length === 0) return "empty";
  if (length < MIN_LENGTH) return "tooShort";
  const words = wordCount(passphrase);
  if (length >= STRONG_LENGTH && words >= GOOD_WORDS) return "strong";
  if (length >= STRONG_LENGTH + 4) return "strong";
  if (length >= GOOD_LENGTH || words >= GOOD_WORDS) return "good";
  return "weak";
}

/** How many of the meter's four segments to fill. */
export function filledSegments(strength: Strength): number {
  switch (strength) {
    case "empty": return 0;
    case "tooShort": return 1;
    case "weak": return 2;
    case "good": return 3;
    case "strong": return 4;
  }
}

/** Whether the passphrase may be used at all. Strength above that is advice. */
export function isAcceptable(passphrase: string): boolean {
  return [...passphrase].length >= MIN_LENGTH;
}

/** The recovery key as shown: groups of four, so it can be read back and copied by hand. */
export function groupRecoveryKey(key: string): string[] {
  const bare = key.replace(/\s+/g, "");
  const groups: string[] = [];
  for (let i = 0; i < bare.length; i += 4) groups.push(bare.slice(i, i + 4));
  return groups;
}
