import { apiRequest } from "@/api/client";
import { API_BASE_URL } from "@/api/config";

export interface MapPin {
  kind: "file" | "folder";
  id: string;
  latitude: number;
  longitude: number;
  source: "exif" | "ip" | null;
  /** Absent for files under `slim=1`; folder pins still carry theirs. */
  name?: string;
}

export interface MapPinsResult {
  pins: MapPin[];
  counts: { gps: number; approximate: number; pending: number };
}

export interface MapFilters {
  folderId?: string | null;
  from?: number | null;
  to?: number | null;
}

export function mapPinsQuery(workspaceId: string, filters?: MapFilters): string {
  // slim=1: the map draws dots, so it asks for coordinates rather than whole
  // file rows. Tapping a pin routes to /file/:id, which loads the file itself -
  // nothing here ever reads a name, a mime type or a share count.
  const qs = new URLSearchParams({ workspace_id: workspaceId, slim: "1" });
  if (filters?.folderId) qs.set("folder_id", filters.folderId);
  if (filters?.from != null) qs.set("from", String(filters.from));
  if (filters?.to != null) qs.set("to", String(filters.to));
  return qs.toString();
}

export async function getMapPins(workspaceId: string, filters?: MapFilters): Promise<MapPinsResult> {
  const res = await apiRequest<{
    ok: true;
    pins?: MapPin[];
    counts?: { gps: number; approximate: number; pending: number };
  }>(`/api/map/pins?${mapPinsQuery(workspaceId, filters)}`);
  // Defaulted rather than trusted: a payload without `pins` should give an empty
  // map, not a screen that throws while rendering.
  return {
    pins: res.pins ?? [],
    counts: res.counts ?? { gps: 0, approximate: 0, pending: 0 },
  };
}

/**
 * Whether the basemap tiles are actually in R2.
 *
 * A plain ranged GET, no auth: /api/map/basemap has no auth check, which is also
 * what lets the WebView fetch the tiles itself. When this is false the page
 * draws a flat background and still plots the pins - a map without tiles is far
 * better than a map that throws on every missing tile.
 */
export async function hasBasemap(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/map/basemap`, { headers: { Range: "bytes=0-0" } });
    return res.ok;
  } catch {
    return false;
  }
}
