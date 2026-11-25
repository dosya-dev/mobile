import { renderHook, act, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useShareMutations } from "./hooks";
import * as api from "./api";

jest.mock("./api");
const wrap = (qc: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

describe("useShareMutations", () => {
  it("revokes then invalidates shares", async () => {
    (api.revokeShare as jest.Mock).mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: 0}, mutations: { gcTime: 0 } } });
    const spy = jest.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useShareMutations(), { wrapper: wrap(qc) });
    await act(async () => { await result.current.revoke.mutateAsync("l1"); });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["shares"] }));
    expect(api.revokeShare).toHaveBeenCalledWith("l1");
  });
});
