import { renderHook, act, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFavourite, __resetFavouriteOverridesForTests } from "./useFavourite";
import { getFavourites } from "@/files/api";
import { addFavourite, removeFavourite } from "@/files/mutations";
import { useWorkspaceStore } from "@/files/workspaceStore";

jest.mock("@/files/api", () => ({ getFavourites: jest.fn() }));
jest.mock("@/files/mutations", () => ({ addFavourite: jest.fn(), removeFavourite: jest.fn() }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));

const row = (id: string) => ({
  id, name: `${id}.mp3`, size_bytes: 1, mime_type: "audio/mpeg", extension: "mp3",
  created_at: 0, updated_at: 0, folder_id: null, lock_mode: "none" as const,
});

/** A request still on the wire, which the test releases when it is done with it. */
function deferred(): { promise: Promise<unknown>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<unknown>((r) => { resolve = () => r({ ok: true }); });
  return { promise, resolve };
}

// gcTime: 0 keeps jest from holding the cache timer open.
let qc: QueryClient;
function setup(fileId: string | null = "a") {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useFavourite(fileId), { wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetFavouriteOverridesForTests();
  useWorkspaceStore.setState({ activeId: "w1" });
  (getFavourites as jest.Mock).mockResolvedValue({ files: [], folders: [] });
});
afterEach(() => qc?.clear());

it("flips the star on press, without waiting for the request", async () => {
  // The whole point: the icon used to change only after POST /api/favourites
  // AND a full re-GET of the favourites list had both come back.
  const inFlight = deferred();
  (addFavourite as jest.Mock).mockReturnValue(inFlight.promise);
  const { result } = setup();
  await waitFor(() => expect(getFavourites).toHaveBeenCalled());
  expect(result.current.isFav).toBe(false);
  act(() => result.current.toggle());
  expect(result.current.isFav).toBe(true); // synchronously, in the same tick as the press
  await waitFor(() => expect(addFavourite).toHaveBeenCalledWith("w1", { fileId: "a" }));
  expect(result.current.isFav).toBe(true); // and still on while the POST is unanswered
  await act(async () => { inFlight.resolve(); });
});

it("un-favouriting drops the row from the cached list with no refetch", async () => {
  (getFavourites as jest.Mock).mockResolvedValue({ files: [row("a"), row("b")], folders: [] });
  (removeFavourite as jest.Mock).mockResolvedValue({ ok: true });
  const { result } = setup();
  await waitFor(() => expect(result.current.isFav).toBe(true));
  (getFavourites as jest.Mock).mockClear();
  act(() => result.current.toggle());
  expect(result.current.isFav).toBe(false);
  await waitFor(() => expect(removeFavourite).toHaveBeenCalledWith("w1", { fileId: "a" }));
  await waitFor(() =>
    expect(qc.getQueryData<{ files: { id: string }[] }>(["favourites", "w1"])?.files.map((f) => f.id)).toEqual(["b"]),
  );
  expect(getFavourites).not.toHaveBeenCalled();
});

it("rolls the star back when the server refuses", async () => {
  (addFavourite as jest.Mock).mockRejectedValue(new Error("nope"));
  const { result } = setup();
  await waitFor(() => expect(getFavourites).toHaveBeenCalled());
  act(() => result.current.toggle());
  expect(result.current.isFav).toBe(true);
  await waitFor(() => expect(result.current.isFav).toBe(false));
});

it("hands the star back to the server list once the refetch lands", async () => {
  (addFavourite as jest.Mock).mockResolvedValue({ ok: true, id: "fav_1" });
  const { result } = setup();
  await waitFor(() => expect(getFavourites).toHaveBeenCalled());
  (getFavourites as jest.Mock).mockResolvedValue({ files: [row("a")], folders: [] });
  act(() => result.current.toggle());
  await waitFor(() => expect(getFavourites).toHaveBeenCalledTimes(2));
  // Still on, but now because the list says so rather than because of the
  // override - which must not outlive its own refetch.
  await waitFor(() => expect(result.current.isFav).toBe(true));
});

it("does nothing at all without a file", () => {
  const { result } = setup(null);
  act(() => result.current.toggle());
  expect(addFavourite).not.toHaveBeenCalled();
  expect(removeFavourite).not.toHaveBeenCalled();
});
