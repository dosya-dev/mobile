// apps/mobile/src/archive/archiveSaveStore.ts
//
// A one-slot holding area between the archive screen and the destination
// picker (app/pick-archive-destination.tsx). A folder plan can name hundreds of
// entries, which is far too much for route params, so the screen parks the job
// here and the picker takes it on first render - the same hand-off shape the
// share-intent store uses for files arriving from outside the app.
import { create } from "zustand";
import type { SavePlan } from "./archiveSave";

export type ArchiveSaveJob = {
  /** The archive being read from. */
  fileId: string;
  archiveName: string;
  version?: string;
} & (
  | { kind: "entry"; index: number; name: string }
  | { kind: "folder"; plan: SavePlan }
);

interface ArchiveSaveState {
  job: ArchiveSaveJob | null;
  /** Replace whatever is parked: a second Save before the picker opened means
   *  the user changed their mind. */
  park: (job: ArchiveSaveJob) => void;
  /** Returns the parked job and empties the slot. Null if there is none. */
  take: () => ArchiveSaveJob | null;
}

export const useArchiveSaveStore = create<ArchiveSaveState>((set, get) => ({
  job: null,
  park: (job) => set({ job }),
  take: () => {
    const { job } = get();
    if (job) set({ job: null });
    return job;
  },
}));
