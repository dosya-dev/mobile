import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // A day, not the 5-minute default. Entries restored from disk at launch
      // (see lib/queryPersist.ts) have no observer until a screen asks for
      // them; with the default they would be garbage-collected before an
      // offline user reached the file they came for.
      gcTime: 24 * 60 * 60 * 1000,
    },
    mutations: { retry: 0 },
  },
});
