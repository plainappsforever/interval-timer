// A − value + control (editor: lengths, rounds, prep, repeats). The value text is editable when `onSubmitText` is
// given (lengths accept "45", "1:30", "1:00:00"); the buttons step by `step` and clamp to [min, max].
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { clampInt } from '@/lib/duration-input';

type Props = {
  testID: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (n: number) => string;
  /** Parses typed text; null = not a value (the field returns to the current value). */
  parse?: (text: string) => number | null;
  onChange: (n: number) => void;
  invalid?: boolean;
};

export function Stepper({ testID, label, value, min, max, step, format = String, parse, onChange, invalid }: Props) {
  const theme = useTheme();
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const set = (n: number) => onChange(clampInt(n, min, max));
  const commit = () => {
    if (draft === null || !parse) return;
    const n = parse(draft);
    setDraft(null);
    if (n !== null) set(n);
  };
  return (
    <View style={styles.row}>
      <ThemedText type="small" style={styles.label}>
        {label}
      </ThemedText>
      <Pressable testID={`${testID}-minus`} accessibilityRole="button" accessibilityLabel={t('editor.decrease', { what: label })} hitSlop={6} onPress={() => set(value - step)} style={[styles.btn, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText type="smallBold">−</ThemedText>
      </Pressable>
      {parse ? (
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={draft ?? format(value)}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          selectTextOnFocus
          style={[styles.value, styles.input, { color: theme.text, borderColor: invalid ? theme.danger : theme.backgroundSelected }]}
        />
      ) : (
        <ThemedText testID={testID} accessibilityLabel={`${label} ${format(value)}`} type="smallBold" style={styles.value}>
          {format(value)}
        </ThemedText>
      )}
      <Pressable testID={`${testID}-plus`} accessibilityRole="button" accessibilityLabel={t('editor.increase', { what: label })} hitSlop={6} onPress={() => set(value + step)} style={[styles.btn, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText type="smallBold">+</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { flex: 1 },
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 76, textAlign: 'center', fontVariant: ['tabular-nums'] },
  input: { borderWidth: 1, borderRadius: Radius.control, paddingVertical: 6, fontSize: 16, fontWeight: '600' },
});
