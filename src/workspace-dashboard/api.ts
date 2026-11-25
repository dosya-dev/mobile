import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/api/client";
import type { WorkspaceDashboardData } from "./helpers";

export function getWorkspaceDashboard(): Promise<{ ok: true } & WorkspaceDashboardData> {
  return apiRequest<{ ok: true } & WorkspaceDashboardData>("/api/workspace-dashboard");
}

export function useWorkspaceDashboard() {
  return useQuery({
    queryKey: ["workspace-dashboard"],
    queryFn: getWorkspaceDashboard,
    staleTime: 60_000,
  });
}
