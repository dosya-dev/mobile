// A round face picture. Ported from the desktop's
// components/personas/FaceAvatar.tsx (from apps/web/src/components/personas/face-avatar.tsx)
// - keep in step.
//
// A crop of the photo's own 256 px thumbnail around the face box the engine
// keeps on this phone (no face image is made or stored anywhere). The
// thumbnail is loaded like any other: URL plus the bearer header. The image
// stays invisible until its size is known, so it never shows uncropped; a
// thumbnail that cannot load shows a people icon.
import { useState } from "react";
import { View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { faceCrop, faceThumbSource, type FaceBox } from "./api";

export interface FaceAvatarProps {
  /** The photo the face is in. */
  fileId: string;
  /** The face, as fractions of that photo. */
  box: FaceBox;
  /** The person's name; null or empty reads as "Face". */
  name: string | null;
  /** Diameter in points; 96 when not given. */
  size?: number;
  testID?: string;
}

export function FaceAvatar({ fileId, box, name, size = 96, testID }: FaceAvatarProps) {
  const t = useT();
  const { tokens } = useColorTheme();
  const source = faceThumbSource(fileId);
  const [loaded, setLoaded] = useState<{ uri: string; w: number; h: number } | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const label = name?.trim() ? name : t("personas.label.face");
  const crop = loaded && loaded.uri === source.uri ? faceCrop(box, loaded.w, loaded.h) : null;

  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={label}
      className="items-center justify-center overflow-hidden rounded-full bg-muted"
      style={{ width: size, height: size }}
    >
      {failedUri === source.uri ? (
        <Icon name="people-outline" size={Math.round(size / 2)} color={tokens.mutedForeground} />
      ) : (
        <ExpoImage
          testID={testID ? `${testID}-image` : undefined}
          source={source}
          style={{
            position: "absolute",
            opacity: crop ? 1 : 0,
            width: `${crop?.width ?? 100}%`,
            height: `${crop?.height ?? 100}%`,
            // rtl-ok: physical geometry, the photo is never mirrored
            left: `${crop?.x ?? 0}%`,
            top: `${crop?.y ?? 0}%`,
          }}
          contentFit="fill"
          recyclingKey={source.uri}
          onLoad={(e) => {
            const w = e?.source?.width ?? 0;
            const h = e?.source?.height ?? 0;
            if (w > 0 && h > 0) setLoaded({ uri: source.uri, w, h });
          }}
          onError={() => setFailedUri(source.uri)}
        />
      )}
    </View>
  );
}
