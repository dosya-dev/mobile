import { Pressable, View } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { stagePalette } from "../stageTheme";

/**
 * A sentence where the file would have been.
 *
 * Centred on the stage rather than in a card: the stage is where the video
 * would have been, and it is where the explanation belongs. Shared by the
 * video stages, which have three distinct ways of not showing a video
 * (undecodable, stalled, and libVLC giving up) and must explain each one.
 */
export function StageMessage(props: {
  testID: string;
  icon: IconName;
  title: string;
  body: string;
  actions: { testID: string; icon: IconName; label: string; onPress: () => void }[];
}) {
  const palette = stagePalette("dark");
  return (
    <View testID={props.testID} className="flex-1 items-center justify-center px-8">
      <View
        className="h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: palette.chrome }}
      >
        <Icon name={props.icon} size={28} color={palette.fg} />
      </View>
      <Text
        className="mt-3.5 text-center text-[15px] font-bold leading-5"
        style={{ color: palette.fg }}
      >
        {props.title}
      </Text>
      <Text
        className="mt-2 max-w-[262px] text-center text-[12.5px] leading-[18px]"
        style={{ color: palette.fgMuted }}
      >
        {props.body}
      </Text>
      {props.actions.length > 0 ? (
        <View className="mt-4 flex-row gap-2.5">
          {props.actions.map((a) => (
            <Pressable
              key={a.testID}
              testID={a.testID}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              onPress={a.onPress}
              className="h-[38px] flex-row items-center gap-2 rounded-xl px-4"
              style={{ backgroundColor: palette.chrome }}
            >
              <Icon name={a.icon} size={16} color={palette.fg} />
              <Text className="text-[13px] font-bold" style={{ color: palette.fg }}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
