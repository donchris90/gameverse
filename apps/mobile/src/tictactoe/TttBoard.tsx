import { theme } from '@gameverse/design-system';
import { displayName, type MatchView } from '@gameverse/shared-types';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReduceMotion } from '../ludo/motion';

const c = theme.colors;

/** Tic-tac-toe has its own look (dark frame, neon X and O) ported from the RRYDA Ox screen. */
export const TTT = {
  surface: 'rgba(255,255,255,0.05)',
  cell: 'rgba(255,255,255,0.045)',
  cellFilled: 'rgba(255,255,255,0.07)',
  cellWin: 'rgba(255,255,255,0.16)',
  border: 'rgba(255,255,255,0.13)',
  x: '#5EEAD4',
  o: '#FDBA74',
  gold: '#F5B841',
  text: '#F4F7FF',
};

export const markColor = (mark: string | null): string =>
  mark === 'X' ? TTT.x : mark === 'O' ? TTT.o : TTT.text;

function Cell({
  value,
  index,
  size,
  highlight,
  dim,
  disabled,
  reduced,
  onPress,
}: {
  value: string | null;
  index: number;
  size: number;
  highlight: boolean;
  dim: boolean;
  disabled: boolean;
  reduced: boolean;
  onPress: () => void;
}) {
  const pop = useRef(new Animated.Value(value ? 1 : 0)).current;
  const previous = useRef<string | null>(value);
  useEffect(() => {
    if (value && !previous.current && !reduced) {
      pop.setValue(0);
      Animated.spring(pop, {
        toValue: 1,
        friction: 5,
        tension: 160,
        useNativeDriver: true,
      }).start();
    } else {
      pop.setValue(value ? 1 : 0);
    }
    previous.current = value;
  }, [value, reduced, pop]);

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Cell ${String(index + 1)}, ${value ?? 'empty'}`}
      accessibilityState={{ disabled }}
      style={[
        styles.cell,
        {
          width: size,
          height: size,
          borderColor: highlight ? markColor(value) : disabled ? 'transparent' : TTT.border,
          backgroundColor: highlight ? TTT.cellWin : value ? TTT.cellFilled : TTT.cell,
          opacity: dim && !highlight ? 0.45 : 1,
        },
      ]}
    >
      <Animated.Text
        style={[
          styles.mark,
          {
            color: markColor(value),
            fontSize: size * 0.58,
            lineHeight: size * 0.7,
            transform: [{ scale: pop }],
          },
        ]}
      >
        {value ?? ''}
      </Animated.Text>
    </Pressable>
  );
}

/** The board. Sizes all come from one number, so the grid is always even. */
export function TttBoard({
  match,
  open,
  width,
  onTap,
}: {
  match: MatchView;
  /** Cells the viewer may tap right now (empty on the opponent's turn or when the game is over). */
  open: ReadonlySet<number>;
  width: number;
  onTap: (cell: number) => void;
}) {
  const { reduced } = useReduceMotion();
  const pad = 12;
  const gap = 10;
  const size = Math.floor((width - pad * 2 - gap * 2) / 3);
  const frame = size * 3 + gap * 2 + pad * 2;
  const cells = match.series?.board ?? Array<null>(9).fill(null);
  const winLine = new Set(match.series?.winLine ?? []);
  const dimOthers = winLine.size > 0;
  return (
    <View
      style={[styles.frame, { width: frame, padding: pad, gap }]}
      accessibilityLabel="Game board"
    >
      {[0, 1, 2].map((row) => (
        <View key={row} style={{ flexDirection: 'row', gap }}>
          {[0, 1, 2].map((col) => {
            const index = row * 3 + col;
            return (
              <Cell
                key={index}
                index={index}
                value={cells[index] ?? null}
                size={size}
                highlight={winLine.has(index)}
                dim={dimOthers}
                disabled={!open.has(index)}
                reduced={reduced}
                onPress={() => onTap(index)}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** Two player cards with each player's mark and, in a best-of-three, their wins as pips. */
export function PlayerStrip({ match }: { match: MatchView }) {
  const series = match.series;
  if (series === null) return null;
  const toMove = match.status === 'ACTIVE' ? series.seatToMove : null;
  return (
    <View style={styles.strip}>
      {match.players.map((player, index) => {
        const seat = player.seat;
        const mark = seat === series.firstSeat ? 'X' : 'O';
        const active = toMove === seat;
        const wins = seat === 0 || seat === 1 ? series.wins[seat] : 0;
        return (
          <View key={seat} style={{ flex: 1, flexDirection: 'row', gap: 8 }}>
            {index === 1 ? (
              <View style={styles.vs}>
                <Text style={styles.vsText}>VS</Text>
              </View>
            ) : null}
            <View
              style={[
                styles.player,
                active && {
                  borderColor: markColor(mark),
                  backgroundColor: 'rgba(255,255,255,0.10)',
                },
              ]}
              accessibilityLabel={`${seat === match.mySeat ? 'You' : displayName(player)}, ${mark}${
                series.bestOf === 3 ? `, ${String(wins)} of 2 wins` : ''
              }${active ? ', their turn' : ''}`}
            >
              <View style={styles.playerTop}>
                <Text style={[styles.playerMark, { color: markColor(mark) }]}>{mark}</Text>
                {series.bestOf === 3 ? (
                  <View style={styles.pips}>
                    {[0, 1].map((pip) => (
                      <View
                        key={pip}
                        style={[
                          styles.pip,
                          pip < wins && { backgroundColor: TTT.gold, borderColor: TTT.gold },
                        ]}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={styles.name}>
                {seat === match.mySeat ? 'You' : displayName(player)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'center',
    borderRadius: 26,
    backgroundColor: TTT.surface,
    borderWidth: 1,
    borderColor: TTT.border,
    marginVertical: theme.spacing.lg,
  },
  cell: { borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  mark: { fontWeight: '900', textAlign: 'center', includeFontPadding: false },
  strip: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginBottom: theme.spacing.md },
  player: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: TTT.border,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
    justifyContent: 'center',
    backgroundColor: TTT.surface,
  },
  playerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playerMark: { fontSize: 22, fontWeight: '900' },
  pips: { flexDirection: 'row', gap: 5 },
  pip: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  name: { color: c.textPrimary, fontSize: 14, fontWeight: '700' },
  vs: { alignSelf: 'center' },
  vsText: { color: c.textSecondary, fontSize: 12, fontWeight: '800' },
});
