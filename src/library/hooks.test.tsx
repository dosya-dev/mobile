import type { ReactNode } from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLibrary, useLibraryTotal } from "./hooks";
import { listLibrary } from "./api";

jest.mock("./api", () => ({ listLibrary: jest.fn() }));

const KEY = ["library", "w1", "photos", "taken_desc", ""];

// FileBrowser (parent) reads the total; LibraryBrowser (child) runs the list.
// Both observe one Query. The total's observer used to carry a queryFn that
// always rejected; effects run child-first, so the parent's options won and
// the next invalidate refetched with the rejecting function - the library
// view fell into "couldn't load photos".
function Child() {
  useLibrary("w1", "photos");
  return null;
}
function Parent({ onTotal }: { onTotal: (n: number | null) => void }): ReactNode {
  onTotal(useLibraryTotal("w1", "photos"));
  return <Child />;
}

it("an invalidate after the total's observer mounted refetches with the real list call", async () => {
  (listLibrary as jest.Mock).mockResolvedValue({ files: [], next_cursor: null, total: 3 });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  let total: number | null = null;
  const view = render(
    <QueryClientProvider client={qc}>
      <Parent onTotal={(n) => { total = n; }} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(total).toBe(3));
  // A re-render runs both observers' setOptions again (child first, parent last).
  view.rerender(
    <QueryClientProvider client={qc}>
      <Parent onTotal={(n) => { total = n; }} />
    </QueryClientProvider>,
  );
  const before = (listLibrary as jest.Mock).mock.calls.length;
  await act(async () => { await qc.invalidateQueries({ queryKey: ["library"] }); });
  expect((listLibrary as jest.Mock).mock.calls.length).toBe(before + 1);
  const state = qc.getQueryState(KEY);
  expect(state?.status).toBe("success");
  expect(state?.error).toBeNull();
  view.unmount();
});
