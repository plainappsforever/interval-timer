/**
 * iOS only (D40, breathe D56 recipe): the SwiftUI layout of the workout Live Activity, built with expo-widgets +
 * @expo/ui. The function marked `'widget'` is turned into a string at build time and runs inside the widget
 * extension, where every @expo/ui/swift-ui component and modifier is a global: it may use only its argument and
 * those globals (no other imports, no module constants). Import this file only through `src/lib/live-activity.ts`.
 * Props come from the pure builder in `src/lib/live-activity-plan.ts`.
 */
import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { activityBackgroundTint, font, foregroundStyle, lineLimit, monospacedDigit, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

import type { WorkoutActivityProps } from '@/lib/live-activity-plan';

/** The Live Activity's name (expo-widgets registers it at run time; no entry in the plugin's `widgets` list). */
export const WORKOUT_ACTIVITY = 'WorkoutActivity';

function WorkoutActivityLayout(props: WorkoutActivityProps) {
  'widget';
  const fg = foregroundStyle(props.textColor);
  const clock = (size: number) =>
    props.paused ? (
      <Text modifiers={[monospacedDigit(), font({ size, weight: 'bold' }), fg]}>{props.pausedClock}</Text>
    ) : (
      <Text
        timerInterval={{ lower: new Date(props.startAt), upper: new Date(props.endAt) }}
        countsDown={props.countsDown}
        modifiers={[monospacedDigit(), font({ size, weight: 'bold' }), fg]}
      />
    );
  return {
    banner: (
      <HStack modifiers={[padding({ all: 16 }), activityBackgroundTint(props.color)]}>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 13, weight: 'semibold' }), fg, lineLimit(1)]}>{props.title}</Text>
          <Text modifiers={[font({ size: 22, weight: 'bold' }), fg, lineLimit(1)]}>{props.interval}</Text>
          <Text modifiers={[font({ size: 13 }), fg, lineLimit(1)]}>{props.detail}</Text>
        </VStack>
        <Spacer />
        {clock(36)}
      </HStack>
    ),
    compactLeading: <Image systemName={props.paused ? 'pause.fill' : 'timer'} />,
    compactTrailing: props.paused ? (
      <Text modifiers={[monospacedDigit(), font({ size: 15, weight: 'semibold' })]}>{props.pausedClock}</Text>
    ) : (
      <Text
        timerInterval={{ lower: new Date(props.startAt), upper: new Date(props.endAt) }}
        countsDown={props.countsDown}
        modifiers={[monospacedDigit(), font({ size: 15, weight: 'semibold' })]}
      />
    ),
    minimal: <Image systemName={props.paused ? 'pause.fill' : 'timer'} />,
    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 8 })]}>
        <Text modifiers={[font({ size: 13 }), lineLimit(1)]}>{props.title}</Text>
        <Text modifiers={[font({ size: 17, weight: 'bold' }), lineLimit(1)]}>{props.interval}</Text>
      </VStack>
    ),
    expandedTrailing: props.paused ? (
      <Text modifiers={[monospacedDigit(), font({ size: 24, weight: 'bold' })]}>{props.pausedClock}</Text>
    ) : (
      <Text
        timerInterval={{ lower: new Date(props.startAt), upper: new Date(props.endAt) }}
        countsDown={props.countsDown}
        modifiers={[monospacedDigit(), font({ size: 24, weight: 'bold' })]}
      />
    ),
    expandedBottom: <Text modifiers={[font({ size: 13 }), lineLimit(1)]}>{props.detail}</Text>,
  };
}

export const WorkoutActivity = createLiveActivity<WorkoutActivityProps>(WORKOUT_ACTIVITY, WorkoutActivityLayout);
