import { StyleSheet, View } from 'react-native';

import type { PatternPiece } from '@/lib/pattern';
import { useTheme } from '@/hooks/use-theme';

/** A thin strip of one block per piece of the timer's pattern, width proportional to its length (D24 sheet). */
export function PatternStrip({ pieces, height = 6 }: { pieces: PatternPiece[]; height?: number }) {
  const theme = useTheme();
  const gap = pieces.length <= 24 ? 1 : 0;
  return (
    <View style={[styles.strip, { height, borderRadius: height / 2 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {pieces.map((p, i) => (
        <View key={i} style={{ flex: p.seconds, backgroundColor: p.kind === 'work' ? p.color : theme.restGrey, marginRight: i < pieces.length - 1 ? gap : 0 }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ strip: { flexDirection: 'row', overflow: 'hidden' } });
