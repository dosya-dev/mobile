import { useQuery, useInfiniteQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/errors";
import { localFirst, offlineFile, offlineListing } from "@/offline/read";
import { isOnlineNow } from "@/offline/network";
import { getWorkspaces, listFiles, getFile, search, getRegions, getWorkspaceStorage } from "./api";
import type { FileFilter, FileItem, FileSort } from "./types";

/**
 * Retry as usual, except when we already know the phone is offline: a
 * transport error then is the answer, and retrying only delays the error
 * screen (or the offline banner) by the length of the backoff.
 */
function retryUnlessOffline(qc: QueryClient) {
  const base = qc.getDefaultOptions().queries?.retry;
  return (failureCount: number, error: Error): boolean => {
    if (error instanceof ApiError && error.status === 0 && isOnlineNow() === false) return false;
    // Otherwise exactly what the client would have done (React Query's own
    // default is 3 when the client sets none).
    if (typeof base === "function") return base(failureCount, error);
    if (typeof base === "number") return failureCount < base;
    if (typeof base === "boolean") return base;
    return failureCount < 3;
  };
}

export function useWorkspaces() {
  return useQuery({ queryKey: ["workspaces"], queryFn: getWorkspaces, staleTime: 5 * 60_000 });
}

export function useFileList(
  workspaceId: string | null, folderId: string | null, filter: FileFilter, sort: FileSort,
  opts: { enabled?: boolean } = {},
) {
  const qc = useQueryClient();
  return useInfiniteQuery({
    queryKey: ["files", workspaceId, folderId, filter, sort],
    enabled: !!workspaceId && (opts.enabled ?? true),
    initialPageParam: 1,
    // offlineFirst: the first fetch always runs, so an offline listing answers
    // from a pinned folder at once (or fails at once) instead of pausing.
    networkMode: "offlineFirst",
    retry: retryUnlessOffline(qc),
    queryFn: ({ pageParam }) =>
      localFirst(
        () => listFiles({ workspaceId: workspaceId as string, folderId, filter, sort, page: pageParam as number }),
        // A pinned folder is one page; there is no page 2 to read locally.
        () => ((pageParam as number) === 1 ? offlineListing(workspaceId as string, folderId, { filter, sort }) : Promise.resolve(null)),
        `folder:${workspaceId}:${folderId ?? ""}`,
      ),
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.total_pages ? last.pagination.page + 1 : undefined,
  });
}

/**
 * One file's full record.
 *
 * `placeholder` is the listing row the user tapped or swiped to. It stands in
 * until GET /api/files/:id answers, so a file that is not cached yet still
 * renders at once instead of reporting `isLoading` - which in the viewer meant
 * swapping the whole pager for a skeleton on every swipe and rebuilding it a
 * moment later.
 */
export function useFile(id: string, placeholder?: FileItem | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["file", id],
    // Same as useFileList: a pinned file's record comes from the phone when the
    // server cannot be reached, and a refusal from the server is never masked.
    networkMode: "offlineFirst",
    retry: retryUnlessOffline(qc),
    queryFn: () => localFirst(() => getFile(id), () => offlineFile(id), `file:${id}`),
    enabled: !!id,
    placeholderData: placeholder && placeholder.id === id ? placeholder : undefined,
  });
}

export function useSearch(workspaceId: string | null, q: string) {
  return useQuery({
    queryKey: ["search", workspaceId, q],
    enabled: !!workspaceId && q.trim().length > 0,
    queryFn: () => search(workspaceId as string, q.trim()),
  });
}

/**
 * The full region catalog, for turning a file's stored `region` code into the
 * city name the details panel shows. DISPLAY only - where a file lives is its
 * workspace's location, chosen once at creation. Cached for an hour: the
 * catalog is effectively static, and every file opened would otherwise refetch
 * it.
 */
export function useRegions() {
  return useQuery({
    queryKey: ["regions"],
    queryFn: async () => (await getRegions()).regions,
    staleTime: 60 * 60_000,
  });
}

export function useWorkspaceStorage(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-storage", workspaceId],
    queryFn: () => getWorkspaceStorage(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}
