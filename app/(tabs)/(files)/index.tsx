import { useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { FilesRootHeader } from "@/files/FilesRootHeader";
import { FileBrowser } from "@/files/FileBrowser";
import { DeletionBanner } from "@/account/DeletionBanner";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { MenuEdgeSwipe } from "@/files/menu/MenuEdgeSwipe";

export default function FilesScreen() {
  const hydrateWorkspace = useWorkspaceStore((s) => s.hydrate);
  useEffect(() => { void hydrateWorkspace(); }, [hydrateWorkspace]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* The left-edge swipe that opens the Files menu: the root only, where it
          cannot meet the stack's back swipe. */}
      <MenuEdgeSwipe>
        <FileBrowser folderId={null} header={(tools) => <FilesRootHeader tools={tools} />} banner={<DeletionBanner />} />
      </MenuEdgeSwipe>
    </SafeAreaView>
  );
}
