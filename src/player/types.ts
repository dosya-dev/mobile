/** One queue entry. Metadata comes from the listing row - no ID3 parsing in v1. */
export interface PlayerTrack {
  fileId: string;
  /** Filename without its final extension. */
  title: string;
  /** Folder name, or the workspace name for root-level queues. */
  artist: string;
  extension: string | null;
  /** size_bytes + updated_at from the listing - the cache invalidation key. */
  sizeBytes: number;
  modifiedAt: number;
}
