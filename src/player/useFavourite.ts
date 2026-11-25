import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { getFavourites } from "@/files/api";
import { addFavourite, removeFavourite } from "@/files/mutations";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { toast } from "@/ui/toast";
import { t } from "@/lib/i18n";

type FavouritesData = Awaited<ReturnType<typeof getFavourites>>;

interface Pending {
  fav: boolean;
  /** Which press this is. A press only ever clears its own. */
  seq: number;
}

interface OverrideState {
  map: Record<string, Pending>;
  /** Record a press and return its sequence number. */
  set: (fileId: string, fav: boolean) => number;
  /** Drop the override, unless a later press has already replaced it. */
  clear: (fileId: string, seq: number) => void;
}

let seqCounter = 0;

/**
 * The favourite state a press asked for, before any request has come back.
 *
 * Without it a tap on the star went: POST /api/favourites, then invalidate,
 * then a full GET of the workspace's favourites - and only when THAT landed
 * did the icon change. Two round trips of nothing happening, on a control the
 * user is still touching.
 *
 * A store rather than component state because the player screen and the file
 * screen can both be showing the same file, and they must flip together.
 */
const useFavouriteOverrides = create<OverrideState>((set) => ({
  map: {},
  set: (fileId, fav) => {
    seqCounter += 1;
    const seq = seqCounter;
    set((s) => ({ map: { ...s.map, [fileId]: { fav, seq } } }));
    return seq;
  },
  clear: (fileId, seq) =>
    set((s) => {
      // A press that resolves after a LATER press has already been recorded
      // must not uncover the older server state underneath it - the newer
      // press owns the icon now, and its own settle will clear it.
      if (s.map[fileId]?.seq !== seq) return s;
      const map = { ...s.map };
      delete map[fileId];
      return { map };
    }),
}));

/** Test seam: overrides are module-global, so a case must not inherit another's. */
export function __resetFavouriteOverridesForTests(): void {
  useFavouriteOverrides.setState({ map: {} });
}

/** Favourite state + toggle for one file, backed by the workspace favourites list. */
export function useFavourite(fileId: string | null): { isFav: boolean; toggle: () => void; busy: boolean } {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const qc = useQueryClient();
  const queryKey = ["favourites", workspaceId];
  const q = useQuery({
    queryKey,
    queryFn: () => getFavourites(workspaceId as string),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
  const pending = useFavouriteOverrides((s) => (fileId ? s.map[fileId] : undefined));
  const setOverride = useFavouriteOverrides((s) => s.set);
  const clearOverride = useFavouriteOverrides((s) => s.clear);
  const serverFav = !!fileId && !!q.data?.files.some((f) => f.id === fileId);
  const isFav = pending ? pending.fav : serverFav;

  const mut = useMutation({
    // Request AND reconciliation both live in mutationFn, not in
    // onSuccess/onError. React Query detaches a mutation's observer when the
    // component unmounts, so those callbacks never fire for a press whose
    // screen was dismissed mid-flight - and an override nothing ever clears
    // would keep the star lying for the rest of the session. mutationFn runs
    // to completion either way.
    //
    // `v.fav` is the state the press asked for, decided synchronously in
    // `toggle`. Deriving it here from the query cache (as this used to) would
    // be a tick behind the icon the user is looking at, so a second press
    // could fire the wrong call.
    mutationFn: async (v: { fav: boolean; seq: number }) => {
      if (!workspaceId || !fileId) return;
      try {
        if (v.fav) await addFavourite(workspaceId, { fileId });
        else await removeFavourite(workspaceId, { fileId });
      } catch (e) {
        clearOverride(fileId, v.seq); // roll back to whatever the list says
        throw e;
      }
      if (!v.fav) {
        // A removal reconciles with no round trip at all: drop the row from
        // the cached list and the favourites screen is already correct.
        qc.setQueryData<FavouritesData>(queryKey, (old) =>
          old ? { ...old, files: old.files.filter((f) => f.id !== fileId) } : old,
        );
        clearOverride(fileId, v.seq);
        return;
      }
      // An addition can't be reconstructed locally - /api/favourites returns a
      // row shape the player never had - so refetch, and hold the override
      // until that refetch lands rather than letting the icon flick back to
      // "not a favourite" in between. Deliberately NOT awaited: the button is
      // disabled while this mutation is pending, and making the user wait out
      // a second request before they can change their mind is the delay this
      // whole hook exists to remove.
      void qc
        .invalidateQueries({ queryKey })
        .catch(() => {})
        .finally(() => clearOverride(fileId, v.seq));
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error.couldnTUpdateFavourites"), "error"),
  });

  return {
    isFav,
    toggle: () => {
      if (!fileId) return;
      const fav = !isFav;
      mut.mutate({ fav, seq: setOverride(fileId, fav) });
    },
    busy: mut.isPending,
  };
}
