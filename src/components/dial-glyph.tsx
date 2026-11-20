import { View } from 'react-native';

// Android has no SF Symbols: the run dials draw their icon from plain views (no icon font, no extra package).
export type DialGlyphKind = 'lock' | 'sound' | 'vibration' | 'live';

export function DialGlyph({ kind, color, off = false }: { kind: DialGlyphKind; color: string; off?: boolean }) {
  return (
    <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }} importantForAccessibility="no-hide-descendants">
      {kind === 'lock' ? <Lock color={color} /> : kind === 'sound' ? <Speaker color={color} /> : kind === 'vibration' ? <Phone color={color} /> : <Card color={color} />}
      {off ? (
        <View style={{ position: 'absolute', width: 32, height: 3, borderRadius: 2, backgroundColor: color, transform: [{ rotate: '-45deg' }] }} />
      ) : null}
    </View>
  );
}

function Lock({ color }: { color: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: 12, height: 9, borderWidth: 2.5, borderBottomWidth: 0, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderColor: color }} />
      <View style={{ width: 20, height: 13, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

function Speaker({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: 6, height: 10, backgroundColor: color }} />
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: 8,
          borderBottomWidth: 8,
          borderRightWidth: 9,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderRightColor: color,
        }}
      />
      <View style={{ width: 6, height: 14, marginLeft: 3, borderWidth: 2.5, borderLeftWidth: 0, borderTopRightRadius: 8, borderBottomRightRadius: 8, borderColor: color }} />
    </View>
  );
}

function Phone({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <View style={{ width: 3, height: 12, borderRadius: 2, backgroundColor: color }} />
      <View style={{ width: 14, height: 24, borderRadius: 4, borderWidth: 2.5, borderColor: color }} />
      <View style={{ width: 3, height: 12, borderRadius: 2, backgroundColor: color }} />
    </View>
  );
}

function Card({ color }: { color: string }) {
  return <View style={{ width: 24, height: 17, borderRadius: 4, borderWidth: 2.5, borderColor: color }} />;
}
