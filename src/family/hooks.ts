import { useQuery } from "@tanstack/react-query";
import { getFamily } from "./api";

export const FAMILY_KEY = ["family"] as const;

export function useFamily() {
  return useQuery({ queryKey: FAMILY_KEY, queryFn: getFamily, staleTime: 30_000 });
}
