import { formatBytes } from "@/lib/format";
import { personColor, tint } from "./colors";
import type { FamilyView } from "./types";

/** One person in the pool: payer or active member, with one colour everywhere (avatar, bar, ring, legend). */
export type FamilyPerson = {
  key: string; name: string; isYou: boolean; isPayer: boolean; colorIndex: number;
  used: number; usedLabel: string; reserved: number | null;
};

/**
 * Everyone in the pool, ranked as the Usage list ranks them (payer first, then
 * by usage), and the colour of each active member row. A member row is matched
 * to its usage row by `user_id`; an older API without it falls back to the
 * name (each usage row used once). An unmatched row takes the next free colour.
 * Mirrors buildPeople in apps/desktop/src/renderer/components/family/FamilySection.tsx.
 */
export function buildPeople(data: FamilyView): { people: FamilyPerson[]; colorOf: Map<string, number>; personKeyOf: Map<string, string> } {
  const people: FamilyPerson[] = (data.usage ?? []).map((u, i) => ({
    key: u.id, name: u.name, isYou: u.is_you, isPayer: u.is_payer, colorIndex: i,
    used: u.used_bytes, usedLabel: u.used_label, reserved: u.reserved_bytes ?? null,
  }));
  const colorOf = new Map<string, number>();
  const personKeyOf = new Map<string, string>();
  const taken = new Set<string>();
  for (const m of data.members ?? []) {
    if (m.status !== "active") continue;
    const match = m.user_id !== undefined
      ? people.find((p) => !p.isPayer && m.user_id !== null && p.key === m.user_id)
      : people.find((p) => !p.isPayer && !taken.has(p.key) && p.name === m.name);
    if (match) {
      taken.add(match.key);
      colorOf.set(m.id, match.colorIndex);
      personKeyOf.set(m.id, match.key);
    } else {
      const extra: FamilyPerson = {
        key: `member:${m.id}`, name: m.name ?? m.email, isYou: false, isPayer: false, colorIndex: people.length,
        used: m.used_bytes ?? 0, usedLabel: formatBytes(m.used_bytes ?? 0), reserved: m.reserved_bytes ?? null,
      };
      people.push(extra);
      colorOf.set(m.id, extra.colorIndex);
      personKeyOf.set(m.id, extra.key);
    }
  }
  return { people, colorOf, personKeyOf };
}

/** One stretch of the pool: someone's used storage, or their reserved space they have not used yet. */
export type PoolSegment = { key: string; bytes: number; color: string };

/** Used storage and reserved-but-unused space, per person, as shares of the pool. */
export function poolSegments(people: FamilyPerson[], dark: boolean, heldTint: number): PoolSegment[] {
  return people.flatMap((p) => {
    const color = personColor(p.colorIndex, dark);
    const held = p.reserved ? Math.max(0, p.reserved - p.used) : 0;
    return [
      { key: `${p.key}:used`, bytes: p.used, color },
      ...(held > 0 ? [{ key: `${p.key}:held`, bytes: held, color: tint(color, heldTint) }] : []),
    ];
  });
}
