jest.mock("./read", () => ({ savedCopy: jest.fn() }));

import { act, renderHook, waitFor } from "@testing-library/react-native";
import { savedCopy } from "./read";
import { useSavedCopies } from "./useSavedCopies";

const copy = (id: string, version = 1) => ({ uri: `file:///docs/offline/acct/files/${id}-v${version}.jpg`, version, rendition: "none" as const });

beforeEach(() => jest.clearAllMocks());

describe("useSavedCopies", () => {
  it("a key is absent while its lookup runs, then holds the copy or null", async () => {
    let resolveA!: (v: unknown) => void;
    (savedCopy as jest.Mock).mockImplementation((id: string) =>
      id === "a" ? new Promise((r) => { resolveA = r; }) : Promise.resolve(null));
    const { result } = renderHook(() => useSavedCopies([{ id: "a", version: 1 }, { id: "b", version: 1 }]));
    await waitFor(() => expect(result.current.copies.b).toBeNull());
    expect("a" in result.current.copies).toBe(false);
    resolveA(copy("a"));
    await waitFor(() => expect(result.current.copies.a).toEqual(copy("a")));
  });

  it("a new version is looked up again, and not shown stale meanwhile", async () => {
    (savedCopy as jest.Mock).mockResolvedValueOnce(copy("a", 1));
    const { result, rerender } = renderHook(({ v }: { v: number }) => useSavedCopies([{ id: "a", version: v }]), { initialProps: { v: 1 } });
    await waitFor(() => expect(result.current.copies.a).toEqual(copy("a", 1)));
    let resolve!: (v: unknown) => void;
    (savedCopy as jest.Mock).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    rerender({ v: 2 });
    expect("a" in result.current.copies).toBe(false);
    resolve(copy("a", 2));
    await waitFor(() => expect(result.current.copies.a).toEqual(copy("a", 2)));
  });

  it("recheck looks again: a copy removed while open reads as gone", async () => {
    (savedCopy as jest.Mock).mockResolvedValueOnce(copy("a"));
    const { result } = renderHook(() => useSavedCopies([{ id: "a", version: 1 }]));
    await waitFor(() => expect(result.current.copies.a).toEqual(copy("a")));
    (savedCopy as jest.Mock).mockResolvedValueOnce(null);
    act(() => result.current.recheck("a"));
    await waitFor(() => expect(result.current.copies.a).toBeNull());
    expect(savedCopy).toHaveBeenCalledTimes(2);
  });

  it("a failed lookup reads as no copy", async () => {
    (savedCopy as jest.Mock).mockRejectedValue(new Error("db"));
    const { result } = renderHook(() => useSavedCopies([{ id: "a", version: 1 }]));
    await waitFor(() => expect(result.current.copies.a).toBeNull());
  });
});
