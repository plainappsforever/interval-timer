import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type Arc = { from: number; to: number; kind: 'work' | 'rest' };

const STEP = 2; // degrees per bar; a 2 degree gap between pieces is one left-out bar (sheet: gaps of 2 degrees)
const MAX_GAPPED = 48; // beyond this many pieces the ring is drawn without gaps so it stays readable

/**
 * The poster ring of the home screen (D24 sheet): the timer's own pattern as arcs around a circle, work in the accent
 * colour, rest in the rest grey. No SVG library in this app: the circle is drawn from short bars rotated about the
 * centre (180 Views; it only shows once on Home). `arcs` empty draws the empty-state ring: all rest grey with one
 * accent arc at the top. Children are centred inside.
 */
export function PatternRing({ arcs, size = 240, thickness = 26, children }: { arcs: Arc[]; size?: number; thickness?: number; children?: ReactNode }) {
  const theme = useTheme();
  const radius = size / 2;
  const bars: { angle: number; color: string }[] = [];
  const count = 360 / STEP;
  const width = Math.ceil((2 * Math.PI * (radius - thickness / 2)) / count) + 0.5;
  const gapped = arcs.length > 1 && arcs.length <= MAX_GAPPED;
  const boundaries = arcs.map((a) => a.from * 360);
  for (let i = 0; i < count; i++) {
    const lo = i * STEP;
    const mid = lo + STEP / 2;
    let color: string = theme.restGrey;
    if (arcs.length === 0) {
      // empty state: one accent arc at the top (about 30 degrees)
      if (mid < 15 || mid > 345) color = theme.tint;
    } else {
      if (gapped && boundaries.some((b) => b >= lo && b < lo + STEP)) continue;
      const arc = arcs.find((a) => mid >= a.from * 360 && mid < a.to * 360);
      if (arc?.kind === 'work') color = theme.tint;
    }
    bars.push({ angle: mid, color });
  }

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {bars.map((b) => (
        <View
          key={b.angle}
          style={[
            styles.bar,
            {
              left: radius - width / 2,
              width,
              height: thickness,
              backgroundColor: b.color,
              transform: [{ rotate: `${b.angle}deg` }],
              transformOrigin: [width / 2, radius, 0],
            },
          ]}
        />
      ))}
      <View style={styles.center}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
