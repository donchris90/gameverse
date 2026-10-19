import { ayoColumns, type PlayerSeat } from '@gameverse/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AYO } from './theme';

/** Most seeds drawn in one bowl; the number badge always shows the true count. */
const MAX_SEEDS_SHOWN = 24;

/** Each seed keeps its own spot in the bowl (a sunflower spiral), so adding one never shuffles the rest. */
export function seedSpot(k: number, bowl: number): { x: number; y: number } {
  const radius = bowl * 0.085 * Math.sqrt(k + 0.4);
  const angle = k * 2.399963;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export interface AyoTableProps {
  mySeat: PlayerSeat;
  /** Seeds in each pit as shown now (mid-replay or the real board). */
  pits: readonly number[];
  alive: readonly boolean[];
  /** Pits the player may tap now. */
  movable: ReadonlySet<number>;
  /** The pit being sown into right now. */
  hot: number | null;
  /** Pits already sown into this turn. */
  trail: readonly number[];
  /** True while a turn is being replayed: nothing is tappable. */
  replaying: boolean;
  /** Width available for the board. */
  width: number;
  opponentName: string;
  roundLabel: string;
  onPit: (pit: number) => void;
}

/** The standing wooden board: two columns of six bowls, drawn with plain views. */
export function AyoTable(props: AyoTableProps) {
  const { mySeat, pits, alive, movable, hot, trail, replaying, width, opponentName } = props;
  const columns = ayoColumns(mySeat);
  const bowl = Math.max(54, Math.min(Math.round((width - 64) / 2 / 1.1), 72));
  const seed = Math.round(bowl * 0.23);
  const inner = bowl - 18;
  const boardWidth = bowl * 2 + 14 + 20 + 4 + 28;
  const mineStart = mySeat === 0 ? 0 : 6;

  const renderPit = (pit: number) => {
    const count = pits[pit] ?? 0;
    const isAlive = alive[pit] ?? true;
    const mine = pit >= mineStart && pit < mineStart + 6;
    const tappable = movable.has(pit) && !replaying;
    const lit = hot === pit;
    return (
      <Pressable
        key={pit}
        disabled={!tappable}
        onPress={() => props.onPit(pit)}
        accessibilityRole="button"
        accessibilityLabel={
          isAlive
            ? `${mine ? 'Your' : 'Their'} pit ${String(pit + 1)}, ${String(count)} seeds${
                tappable ? ', tap to play' : ''
              }`
            : `Pit ${String(pit + 1)}, out of the game`
        }
        accessibilityState={{ disabled: !tappable }}
        style={{
          width: bowl,
          height: bowl,
          alignSelf: 'center',
          opacity: isAlive ? 1 : 0.25,
          transform: [{ scale: lit ? 1.06 : 1 }],
        }}
      >
        <View
          style={[
            styles.ring,
            mine && isAlive && styles.ringMine,
            trail.includes(pit) && !lit && styles.ringTrail,
            tappable && styles.ringTap,
            lit && styles.ringHot,
          ]}
        >
          <View style={styles.bowl}>
            <View style={styles.bowlInner}>
              {isAlive
                ? Array.from({ length: Math.min(count, MAX_SEEDS_SHOWN) }).map((_, k) => {
                    const spot = seedSpot(k, bowl);
                    return (
                      <View
                        key={k}
                        style={[
                          styles.seed,
                          {
                            width: seed,
                            height: seed * 0.86,
                            left: inner / 2 + spot.x - seed / 2,
                            top: inner / 2 + spot.y - seed * 0.43,
                            backgroundColor: AYO.seeds[k % AYO.seeds.length],
                            transform: [{ rotate: `${String((k * 53) % 180)}deg` }],
                          },
                          lit && k === count - 1 && replaying && styles.seedNew,
                        ]}
                      />
                    );
                  })
                : null}
            </View>
          </View>
        </View>
        {isAlive ? (
          <View style={[styles.badge, count === 0 && { opacity: 0.45 }]}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={[styles.board, { width: boardWidth }]} accessibilityLabel="Ayo board">
      <View style={styles.heads}>
        <Text style={styles.head} numberOfLines={1}>
          {opponentName} ▼
        </Text>
        <Text style={styles.round}>{props.roundLabel}</Text>
        <Text style={[styles.head, { textAlign: 'right' }]} numberOfLines={1}>
          ▲ You
        </Text>
      </View>
      <View style={styles.cols}>
        <View style={styles.col}>{columns.left.map(renderPit)}</View>
        <View style={styles.col}>{columns.right.map(renderPit)}</View>
        <View pointerEvents="none" style={styles.seam} />
        <View pointerEvents="none" style={[styles.hinge, { top: '24%' }]}>
          <View style={styles.screw} />
          <View style={styles.screw} />
        </View>
        <View pointerEvents="none" style={[styles.hinge, { top: '70%' }]}>
          <View style={styles.screw} />
          <View style={styles.screw} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    alignSelf: 'center',
    borderRadius: 16,
    padding: 10,
    borderWidth: 2,
    borderColor: AYO.woodEdge,
    backgroundColor: AYO.wood,
    gap: 6,
  },
  heads: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  head: { flex: 1, color: AYO.woodInk, fontSize: 10, fontWeight: '900' },
  round: { color: AYO.woodInk, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  cols: { flexDirection: 'row', gap: 14 },
  col: { flex: 1, gap: 6 },
  seam: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: 'rgba(110,70,30,0.45)',
    borderRadius: 2,
  },
  hinge: {
    position: 'absolute',
    left: '50%',
    width: 18,
    height: 28,
    marginLeft: -9,
    borderRadius: 3,
    backgroundColor: '#D2AC52',
    borderWidth: 1,
    borderColor: '#8F6F26',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 3,
  },
  screw: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#7A6120' },
  ring: { flex: 1, borderRadius: 999, borderWidth: 2, borderColor: 'transparent', padding: 1 },
  ringMine: { borderColor: 'rgba(224,169,58,0.75)' },
  ringTrail: { borderColor: 'rgba(255,255,255,0.7)' },
  ringTap: {
    borderColor: AYO.green,
    shadowColor: AYO.green,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    elevation: 6,
  },
  ringHot: {
    borderColor: '#FFFFFF',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 8,
  },
  // A lighter lip at the bottom and a darker one at the top gives the carved-in look.
  bowl: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: '#C99456',
    borderWidth: 2,
    borderTopColor: '#8F5E2B',
    borderLeftColor: '#A8722F',
    borderBottomColor: '#F3CE98',
    borderRightColor: '#E3B880',
    padding: 3,
  },
  bowlInner: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: '#B07A3E',
    borderWidth: 1,
    borderTopColor: '#7A4C20',
    borderLeftColor: '#93602A',
    borderBottomColor: '#D9A869',
    borderRightColor: '#C99456',
    overflow: 'hidden',
  },
  seed: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: 'rgba(60,60,50,0.35)',
  },
  seedNew: { borderColor: '#FFB020', borderWidth: 1.5 },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: 'rgba(60,35,12,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: AYO.text, fontSize: 10, fontWeight: '900' },
});
