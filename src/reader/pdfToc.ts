import { t } from "@/lib/i18n";
import type { TocItem } from "./bridge";

export interface PdfOutlineNode { title?: string; pageIdx?: number; children?: PdfOutlineNode[] }

export function flattenPdfOutline(nodes: PdfOutlineNode[] | undefined, depth = 0, out: TocItem[] = []): TocItem[] {
  for (const n of nodes ?? []) {
    out.push({ label: n.title || t("reader.label.untitled"), href: String((n.pageIdx ?? 0) + 1), depth });
    flattenPdfOutline(n.children, depth + 1, out);
  }
  return out;
}

export const pageLocation = (page: number) => `page:${page}`;

export function parsePageLocation(location: string | null): number | null {
  if (!location) return null;
  const m = /^page:(\d+)$/.exec(location);
  if (!m) return null;
  const page = Number(m[1]);
  return page >= 1 ? page : null;
}
