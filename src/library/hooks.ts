import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query";
import { listLibrary, type LibraryKind, type LibrarySort } from "./api";

/**
 * The one definition of a library query: key, fetch and paging. Every observer
 * of a library key must use it - observers on one key share a single Query, and
 * the last observer to run setOptions decides the queryFn an invalidate refetches
 * with, so a second observer with a different (or stub) queryFn would replace
 * the real fetch for everyone.
 */
export function libraryQueryOptions(workspaceId: string | null, kind: LibraryKind, sort: LibrarySort = "taken_desc", q = "") {
  return infiniteQueryOptions({
    queryKey: ["library", workspaceId, kind, sort, q],
    enabled: !!workspaceId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listLibrary({ workspaceId: workspaceId as string, kind, cursor: pageParam, sort, q }),
    // `next_cursor` decides - never a page's length; a page can be shorter than the limit and still have a cursor.
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useLibrary(workspaceId: string | null, kind: LibraryKind, sort: LibrarySort = "taken_desc", q = "") {
  return useInfiniteQuery(libraryQueryOptions(workspaceId, kind, sort, q));
}

/**
 * The library's total for a kind, read from the first page of the same query
 * LibraryBrowser runs (same options, so no extra fetch: this observer is
 * disabled and only follows the cache, and it carries the real queryFn so it
 * cannot replace LibraryBrowser's). null until that page has arrived, and null
 * outside a library view.
 */
export function useLibraryTotal(workspaceId: string | null, kind: LibraryKind | null, sort: LibrarySort = "taken_desc"): number | null {
  const q = useInfiniteQuery({ ...libraryQueryOptions(workspaceId, kind ?? "photos", sort), enabled: false });
  if (!kind) return null;
  const total = q.data?.pages[0]?.total;
  return typeof total === "number" ? total : null;
}
