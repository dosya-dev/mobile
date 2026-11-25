// Mirrors apps/web/src/lib/library-request.ts mergeLibraryPages - keep in sync.
import type { LibraryItem, LibraryPage } from "./api";

export interface MonthGroup {
  key: string;
  label: string;
  /** The month's full total from the server - right even while only part of it is loaded. */
  count: number;
  files: LibraryItem[];
}

export interface Library {
  months: MonthGroup[];
  /** Every loaded item in stream order - what the viewer pages through. */
  files: LibraryItem[];
  total: number;
  loaded: number;
  hasMore: boolean;
  canLock: boolean;
  canHide: boolean;
}

/** A month may continue from one page into the next; join those into one group so its header is never repeated. */
export function mergeLibraryPages(pages: LibraryPage[]): Library {
  const first = pages[0];
  const counts = first?.counts ?? {};
  const months: MonthGroup[] = [];
  const files: LibraryItem[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const m of page.months) {
      const fresh = m.files.filter((f) => !seen.has(f.id));
      for (const f of fresh) seen.add(f.id);
      const last = months[months.length - 1];
      if (last && last.key === m.key) last.files.push(...fresh);
      else months.push({ key: m.key, label: m.label, count: counts[m.key] ?? m.files.length, files: [...fresh] });
      files.push(...fresh);
    }
  }
  const lastPage = pages[pages.length - 1];
  return {
    months, files,
    total: first?.total ?? 0,
    loaded: files.length,
    hasMore: !!lastPage && lastPage.next_cursor != null,
    canLock: first?.can_lock ?? false,
    canHide: first?.can_hide ?? false,
  };
}

/** Rows of `n` tiles for a SectionList - it renders rows, not cells. */
export function chunkRows<T>(items: T[], n: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return rows;
}
