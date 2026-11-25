import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

/**
 * One arc on the orbit button's rim.
 *
 * `DownloadRing` draws the same shape, but it owns a whole button: it decides
 * its own colours, picks its own glyph and reads a `DownloadEntry` to do it.
 * The orbit button needs two arcs of different radii reporting two unrelated
 * things, so this is the geometry alone with the meaning left to the caller.
 */

/** Bridges the 2% progress throttle. Linear, because an ease would misreport the rate. */
const ARC_MS = 260;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function OrbitArc(props: {
  /** The disc's diameter. The arc is drawn inside it. */
  size: number;
  /** How far in from the disc's edge the stroke's centreline sits. */
  inset: number;
  stroke: number;
  /** 0..1. */
  fraction: number;
  color: string;
  trackColor: string;
  /**
   * Off for the playback arc: its source polls on a 2s interval, so tweening
   * between samples would draw a position the player never reported.
   */
  animate?: boolean;
  testID?: string;
}) {
  const { size, inset, stroke, color, trackColor } = props;
  const fraction = Math.min(1, Math.max(0, props.fraction));
  const radius = (size - stroke) / 2 - inset;
  const circumference = 2 * Math.PI * radius;

  const anim = useRef(new Animated.Value(fraction)).current;
  useEffect(() => {
    if (!props.animate) {
      anim.setValue(fraction);
      return;
    }
    const arc = Animated.timing(anim, {
      toValue: fraction,
      duration: ARC_MS,
      easing: Easing.linear,
      // strokeDashoffset is an SVG prop, not a transform, so it cannot run on
      // the UI thread.
      useNativeDriver: false,
    });
    arc.start();
    // A JS-driven animation keeps stepping itself after the arc unmounts: the
    // pending frame outlives the component, and under jest it fires after the
    // environment is torn down and fails the run.
    return () => arc.stop();
  }, [fraction, anim, props.animate]);

  const offset = anim.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] });

  return (
    <View pointerEvents="none" style={{ position: "absolute", width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* rtl-ok: centering (the track circle sits on the disc's centre) */}
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          testID={props.testID}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          // Start at twelve o'clock rather than three.
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
    </View>
  );
}
