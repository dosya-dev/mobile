import { renderHook, act, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFileMutations } from "./mutationHooks";
import * as mutations from "./mutations";

jest.mock("./mutations");
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useFileMutations", () => {
  // This file has no global clearAllMocks and several specs share the same
  // auto-mocked module, so a spec that counts calls resets its own mock.
  const deleteFolderMock = () => {
    const fn = mutations.deleteFolder as jest.Mock;
    fn.mockReset();
    return fn;
  };

  it("keeps calling the folder delete until the server says the purge finished", async () => {
    // The permanent purge is bounded server-side: 202 with complete:false means
    // "budget spent, ask again". Firing it once reported a half-emptied folder
    // as deleted.
    deleteFolderMock()
      .mockResolvedValueOnce({ ok: true, permanent: true, complete: false, remaining: 120, files_affected: 100 })
      .mockResolvedValueOnce({ ok: true, permanent: true, complete: false, remaining: 20, files_affected: 100 })
      .mockResolvedValueOnce({ ok: true, permanent: true, complete: true, remaining: 0, files_affected: 20 });
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: 0}, mutations: { gcTime: 0 } } });
    const { result } = renderHook(() => useFileMutations(), { wrapper: wrapper(qc) });

    let outcome;
    await act(async () => { outcome = await result.current.removeFolder.mutateAsync("fold_1"); });

    expect(mutations.deleteFolder).toHaveBeenCalledTimes(3);
    expect(mutations.deleteFolder).toHaveBeenCalledWith("fold_1");
    expect(outcome).toEqual({ complete: true, filesAffected: 220, remaining: 0, calls: 3 });
  });

  it("passes an ordinary move-to-trash through in a single call", async () => {
    deleteFolderMock().mockResolvedValue({ ok: true });
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: 0}, mutations: { gcTime: 0 } } });
    const { result } = renderHook(() => useFileMutations(), { wrapper: wrapper(qc) });
    await act(async () => { await result.current.removeFolder.mutateAsync("fold_2"); });
    expect(mutations.deleteFolder).toHaveBeenCalledTimes(1);
  });

  it("renames then invalidates the files and library queries", async () => {
    (mutations.renameFile as jest.Mock).mockResolvedValue({ ok: true });
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: 0}, mutations: { gcTime: 0 } } });
    const spy = jest.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useFileMutations(), { wrapper: wrapper(qc) });
    await act(async () => { await result.current.rename.mutateAsync({ id: "f1", name: "n.txt" }); });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["files"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["library"] });
    expect(mutations.renameFile).toHaveBeenCalledWith("f1", "n.txt");
  });
});
