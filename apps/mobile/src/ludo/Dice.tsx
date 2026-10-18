import { theme } from '@gameverse/design-system';
import { diePips } from '@gameverse/shared-types';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const SIZE = 72;
const PIP = 12;

/**
 * The die. It shows the number the server rolled (the phone never picks one) and, on your turn
 * to roll, is the button that asks the server to roll.
 */
export function Dice({
  value,
  canRoll,
  busy,
  reduced,
  onRoll,
}: {
  value: number | null;
  canRoll: boolean;
  busy: boolean;
  reduced: boolean;
  onRoll: () => void;
}) {
  const turn = useSharedValue(0);

  useEffect(() => {
    if (value === null || reduced) return;
    turn.value = withSequence(
      withTiming(-12, { duration: 70 }),
      withTiming(12, { duration: 90 }),
      withTiming(0, { duration: 70 }),
    );
  }, [value, reduced, turn]);

  const shake = useAnimatedStyle(() => ({ transform: [{ rotate: `${String(turn.value)}deg` }] }));
  const pips = diePips(value);

  return (
    <Pressable
      onPress={onRoll}
      disabled={!canRoll || busy}
      accessibilityRole="button"
      accessibilityLabel={
        canRoll ? 'Roll the die' : value === null ? 'The die' : `The die shows ${String(value)}`
      }
      accessibilityState={{ disabled: !canRoll || busy, busy }}
      style={styles.wrap}
    >
      <Animated.View
        style={[
          styles.die,
          canRoll && { borderColor: theme.colors.primary, borderWidth: 4 },
          !canRoll && { opacity: 0.85 },
          shake,
        ]}
      >
        {pips.map(([column, row]) => (
          <View
            key={`${String(column)}-${String(row)}`}
            style={[
              styles.pip,
              {
                left: 10 + column * ((SIZE - 20 - PIP) / 2) - 0,
                top: 10 + row * ((SIZE - 20 - PIP) / 2) - 0,
              },
            ]}
          />
        ))}
        {value === null ? <Text style={styles.hint}>{canRoll ? 'ROLL' : ''}</Text> : null}
      </Animated.View>
      <Text style={styles.caption}>{canRoll ? 'Tap to roll' : ''}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', minWidth: 96, minHeight: 96, justifyContent: 'center' },
  die: {
    width: SIZE,
    height: SIZE,
    borderRadius: 14,
    backgroundColor: '#F5F5FF',
    borderWidth: 2,
    borderColor: '#33377A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pip: {
    position: 'absolute',
    width: PIP,
    height: PIP,
    borderRadius: PIP / 2,
    backgroundColor: '#0B0C24',
  },
  hint: { color: '#0B0C24', fontWeight: '800', fontSize: 16 },
  caption: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 4, minHeight: 16 },
});
