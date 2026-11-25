import { useState } from "react";
import { View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { getAccessToken } from "@/auth/authStore";

/**
 * A square avatar chip: the image when there is one, else initials on a colour
 * background. Used for workspace icons (and the user avatar later).
 *
 * The image endpoint is authenticated and streams bytes directly (no redirect),
 * so the Bearer header on this single request is enough. On any load failure we
 * fall back to initials rather than showing a broken image.
 */
export function Avatar(props: {
  imageUrl?: string | null;
  initials: string;
  color: string;
  size?: number;
  radius?: number;
  /** Initials colour. Defaults to white (workspace chips); the user avatar uses muted-on-muted. */
  textColor?: string;
  testID?: string;
}) {
  const [failed, setFailed] = useState(false);
  const size = props.size ?? 32;
  const radius = props.radius ?? Math.round(size * 0.25);
  const label = (props.initials ?? "").trim().slice(0, 2).toUpperCase();

  if (props.imageUrl && !failed) {
    const token = getAccessToken();
    return (
      <View
        testID={props.testID}
        className="overflow-hidden bg-muted"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <ExpoImage
          testID={props.testID ? `${props.testID}-img` : undefined}
          source={{ uri: props.imageUrl, headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          cachePolicy="disk"
          transition={100}
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  return (
    <View
      testID={props.testID}
      className="items-center justify-center"
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: props.color }}
    >
      {label ? (
        <Text
          testID={props.testID ? `${props.testID}-initials` : undefined}
          style={{
            fontFamily: fonts.bold,
            fontSize: Math.max(9, Math.round(size * 0.34)),
            color: props.textColor ?? "#ffffff",
          }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}
