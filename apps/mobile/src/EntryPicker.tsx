import { theme } from '@gameverse/design-system';
import { ENTRY_FEE_TIERS, formatCoins, type EntryFee } from '@gameverse/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body } from './ui';

const c = theme.colors;
const s = theme.spacing;

/**
 * Chooses the entry fee for a match against other people, in bonus coins. "Free" is always
 * available; a tier the player cannot afford is shown but cannot be chosen. The server checks the
 * balance again, so this is a convenience, never the rule.
 */
export function EntryPicker({
  value,
  onChange,
  balance,
  disabled = false,
}: {
  value: EntryFee;
  onChange: (fee: EntryFee) => void;
  /** Null while the balance is still loading: only Free is offered until it is known. */
  balance: number | null;
  disabled?: boolean;
}) {
  return (
    <View style={styles.wrap} accessibilityLabel="Entry fee">
      <Body muted>
        Entry fee (bonus coins). The winner takes the pot; a draw or a cancelled match returns
        everyone's coins.
      </Body>
      <View style={styles.row}>
        {ENTRY_FEE_TIERS.map((fee) => {
          const affordable = fee === 0 || (balance !== null && balance >= fee);
          const selected = value === fee;
          const label = fee === 0 ? 'Free' : formatCoins(fee);
          return (
            <Pressable
              key={fee}
              accessibilityRole="button"
              accessibilityLabel={
                fee === 0
                  ? 'Free, no entry fee'
                  : `${label} bonus coins${affordable ? '' : ', not enough coins'}`
              }
              accessibilityState={{ selected, disabled: disabled || !affordable }}
              disabled={disabled || !affordable}
              onPress={() => onChange(fee)}
              style={[
                styles.chip,
                selected && styles.chipOn,
                (disabled || !affordable) && styles.chipOff,
              ]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: s.sm, marginBottom: s.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: s.sm },
  chip: {
    minWidth: 64,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s.md,
    borderRadius: theme.radii.pill,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  chipOn: { borderColor: c.primary, backgroundColor: c.primary },
  chipOff: { opacity: 0.4 },
  chipText: { color: c.textPrimary, fontWeight: '700', fontSize: 15 },
  chipTextOn: { color: c.textOnAccent },
});
