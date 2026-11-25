import { useEffect, useState } from "react";
import { View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import { Icon } from "@/ui/Icon";

const TILES = 8;

/**
 * The photos actually being backed up, on the last step of setup.
 *
 * Setup ends on the product working, and a counter alone does not show that.
 * These are the user's own most recent photos, which is only possible here
 * because photo access was granted two steps earlier - the pre-auth deck uses
 * drawn stand-ins for the same reason it cannot use these.
 *
 * Reading the newest few assets is cheap: one bounded getAssetsAsync page, no
 * per-asset resolution, and nothing is downloaded from iCloud. If it fails or
 * the library is empty the grid simply does not render - it is a flourish on
 * top of the counter, never the thing carrying the information.
 */
export function BackupPreviewGrid({ doneCount }: { doneCount: number }) {
  const [uris, setUris] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const page = await MediaLibrary.getAssetsAsync({
          first: TILES,
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        });
        if (alive) setUris(page.assets.map((a) => a.uri));
      } catch {
        // No preview is fine; the counter above still reports the run.
      }
    })();
    return () => { alive = false; };
  }, []);

  if (uris.length === 0) return null;

  return (
    <View testID="backup-preview-grid" className="mt-4 gap-1" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1].map((row) => (
        <View key={row} className="flex-row gap-1">
          {Array.from({ length: 4 }, (_, col) => {
            const i = row * 4 + col;
            const uri = uris[i];
            if (!uri) return <View key={i} className="flex-1" style={{ aspectRatio: 1 }} />;
            // The first `doneCount` tiles read as backed up. It is a
            // proportional impression, not a per-asset claim - the engine
            // uploads in its own order.
            const done = i < Math.min(doneCount, TILES);
            return (
              <View key={i} className="relative flex-1 overflow-hidden rounded-md" style={{ aspectRatio: 1 }}>
                <ExpoImage source={{ uri }} style={{ flex: 1 }} contentFit="cover" transition={180} />
                {done ? (
                  <View className="absolute bottom-1 end-1 h-4 w-4 items-center justify-center rounded-full bg-primary">
                    <Icon name="checkmark" size={11} color="#fff" />
                  </View>
                ) : (
                  <View className="absolute inset-0 bg-background/55" />
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
