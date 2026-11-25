import { renderHook } from "@testing-library/react-native";
import { useKeyedCallbacks } from "./useKeyedCallbacks";

it("returns one function per key across renders, which calls the latest closure", () => {
  const calls: string[] = [];
  const { result, rerender } = renderHook(() => useKeyedCallbacks());
  const a1 = result.current("a", () => calls.push("a1"));
  rerender({});
  const a2 = result.current("a", () => calls.push("a2"));
  const b = result.current("b", () => calls.push("b"));
  expect(a2).toBe(a1);
  expect(b).not.toBe(a1);
  a1();
  b();
  expect(calls).toEqual(["a2", "b"]);
});
