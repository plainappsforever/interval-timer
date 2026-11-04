// iOS foreground haptics for cues (D17): one-shot expo-haptics taps while the screen is on; Android vibrates from the
// native session runner instead (locked and foreground), so this is a no-op there.
import * as Haptics from 'expo-haptics';
import { AppState, Platform } from 'react-native';

import type { CueKind } from '@/engine/schedule';

export function cueHaptic(kind: CueKind): void {
  if (Platform.OS !== 'ios' || AppState.currentState !== 'active') return;
  const run = (): Promise<void> => {
    switch (kind) {
      case 'countdown':
      case 'openTick':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      case 'halfway':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      case 'start':
      case 'round':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      case 'end':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };
  run().catch(() => {});
}
