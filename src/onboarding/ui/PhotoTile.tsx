import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { Icon } from "@/ui/Icon";

/**
 * A drawn stand-in for a photo, for the pre-auth value deck.
 *
 * The deck runs BEFORE sign-in and before photo permission, so it cannot show
 * the user's own library - asking for the photo permission from a marketing
 * slide is the exact pattern this redesign exists to remove. These are
 * illustrations, and they are drawn rather than bundled as images so they stay
 * crisp at any density and cost nothing to download.
 *
 * Step 4 is the opposite case: permission has been granted two steps earlier,
 * so it shows real thumbnails.
 *
 * The palette here is deliberately literal (sky, sand, foliage) rather than
 * themed - these read as photographs, not as UI surfaces, so theme tokens
 * would be the wrong vocabulary.
 */
const SCENES = [
  // mountains at dusk
  (
    <>
      <Rect width={60} height={60} fill="#20415c" />
      <Circle cx={45} cy={15} r={7} fill="#f0c86a" />{/* rtl-ok: physical geometry */}
      <Path d="M0 40l16-13 12 9 13-11 19 15v20H0z" fill="#16324a" />{/* rtl-ok: physical geometry */}
      <Path d="M0 47l14-9 15 10 17-8 14 8v12H0z" fill="#0e2438" />{/* rtl-ok: physical geometry */}
    </>
  ),
  // sunset over water
  (
    <>
      <Rect width={60} height={60} fill="#e8935c" />
      <Rect y={34} width={60} height={26} fill="#2a5f7a" />
      <Circle cx={30} cy={30} r={9} fill="#fbe0a8" />{/* rtl-ok: physical geometry */}
      <Path d="M0 44h60v3H0zm0 8h60v2H0z" fill="#1f4d65" opacity={0.55} />{/* rtl-ok: physical geometry */}
    </>
  ),
  // portrait
  (
    <>
      <Rect width={60} height={60} fill="#d9e3e8" />
      <Rect x={9} y={12} width={42} height={42} rx={21} fill="#c2743f" />{/* rtl-ok: physical geometry */}
      <Rect x={17} y={30} width={26} height={30} rx={13} fill="#3d5b73" />{/* rtl-ok: physical geometry */}
      <Circle cx={30} cy={27} r={12} fill="#d98b52" />{/* rtl-ok: physical geometry */}
    </>
  ),
  // city at night
  (
    <>
      <Rect width={60} height={60} fill="#1a2b33" />
      <Rect x={6} y={20} width={10} height={40} fill="#2f4b57" />{/* rtl-ok: physical geometry */}
      <Rect x={20} y={10} width={12} height={50} fill="#3b5c6b" />{/* rtl-ok: physical geometry */}
      <Rect x={36} y={26} width={9} height={34} fill="#2a4450" />{/* rtl-ok: physical geometry */}
      <Rect x={48} y={16} width={9} height={44} fill="#35525f" />{/* rtl-ok: physical geometry */}
      <Rect x={22} y={16} width={3} height={3} fill="#f5d98a" />{/* rtl-ok: physical geometry */}
      <Rect x={28} y={24} width={3} height={3} fill="#f5d98a" />{/* rtl-ok: physical geometry */}
      <Rect x={9} y={28} width={3} height={3} fill="#f5d98a" />{/* rtl-ok: physical geometry */}
      <Rect x={50} y={22} width={3} height={3} fill="#f5d98a" />{/* rtl-ok: physical geometry */}
    </>
  ),
  // a framed print
  (
    <>
      <Rect width={60} height={60} fill="#f2ece1" />
      <Rect x={12} y={8} width={36} height={44} rx={3} fill="#ffffff" />{/* rtl-ok: physical geometry */}
      <Path d="M18 40l7-9 6 7 5-6 8 8z" fill="#6a8f5e" />{/* rtl-ok: physical geometry */}
      <Circle cx={38} cy={19} r={4} fill="#e0b45c" />{/* rtl-ok: physical geometry */}
    </>
  ),
  // a plant
  (
    <>
      <Rect width={60} height={60} fill="#2c3f2e" />
      <Path d="M30 8c8 8 12 16 12 24a12 12 0 0 1-24 0c0-8 4-16 12-24z" fill="#5c8a4a" />{/* rtl-ok: physical geometry */}
      <Rect x={28} y={38} width={4} height={18} fill="#3c5433" />{/* rtl-ok: physical geometry */}
    </>
  ),
  // coastline
  (
    <>
      <Rect width={60} height={60} fill="#b7c9d4" />
      <Path d="M0 36l18-20 14 16 10-9 18 21v16H0z" fill="#7d95a5" />{/* rtl-ok: physical geometry */}
      <Path d="M0 44l20-12 16 12 12-6 12 9v13H0z" fill="#586d7c" />{/* rtl-ok: physical geometry */}
      <Circle cx={14} cy={13} r={6} fill="#eef4f7" />{/* rtl-ok: physical geometry */}
    </>
  ),
  // a record
  (
    <>
      <Rect width={60} height={60} fill="#3a2f4a" />
      <Circle cx={30} cy={26} r={14} fill="#8d6fb0" />{/* rtl-ok: physical geometry */}
      <Circle cx={30} cy={26} r={7} fill="#d3bde8" />{/* rtl-ok: physical geometry */}
      <Rect y={46} width={60} height={14} fill="#241d2f" />
    </>
  ),
];

export const PHOTO_TILE_COUNT = SCENES.length;

export function PhotoTile({
  scene,
  done = false,
  dimmed = false,
}: {
  scene: number;
  /** Show the backed-up tick. */
  done?: boolean;
  /** Not yet backed up - held back so the ticked ones read as progress. */
  dimmed?: boolean;
}) {
  return (
    <View className="relative flex-1 overflow-hidden rounded-md" style={{ aspectRatio: 1 }}>
      <Svg viewBox="0 0 60 60" width="100%" height="100%">
        {SCENES[scene % SCENES.length]}
      </Svg>
      {dimmed ? <View className="absolute inset-0 bg-background/55" /> : null}
      {done ? (
        <View className="absolute bottom-1 end-1 h-4 w-4 items-center justify-center rounded-full bg-primary">
          <Icon name="checkmark" size={11} color="#fff" />
        </View>
      ) : null}
    </View>
  );
}
