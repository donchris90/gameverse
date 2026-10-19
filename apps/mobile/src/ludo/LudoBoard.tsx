import { ludoColors } from '@gameverse/design-system';
import {
  LUDO_BOARD_SIZE,
  BASE_ORIGINS,
  basePoint,
  boardSquares,
  layoutTokens,
  movePath,
  tokenPoint,
  type TokenSpot,
} from '@gameverse/game-rules';
import { colourName, tokenDescription, type LudoView } from '@gameverse/shared-types';
import { memo, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Polygon, Rect } from 'react-native-svg';

const HOP_MS = 110;
const FRAME = 6;
const SETTLE_MS = 140;

/** The five-point star drawn on a safe square, centred at (cx, cy). */
function starPoints(cx: number, cy: number, outer: number): string {
  const inner = outer * 0.45;
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(
      `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return points.join(' ');
}

/** The board itself. It never changes during a game, so it is drawn once. */
const StaticBoard = memo(function StaticBoard({
  cell,
  activeColours,
}: {
  cell: number;
  activeColours: readonly number[];
}) {
  const squares = useMemo(() => boardSquares(), []);
  const size = cell * LUDO_BOARD_SIZE;
  const mid = cell * 7.5;
  return (
    <Svg width={size} height={size} accessibilityElementsHidden importantForAccessibility="no">
      <Rect x={0} y={0} width={size} height={size} fill={ludoColors.boardBackground} />
      {BASE_ORIGINS.map((origin, colour) => {
        const active = activeColours.includes(colour);
        const tone = ludoColors.players[colour];
        return (
          <G key={`base-${String(colour)}`} opacity={active ? 1 : 0.28}>
            <Rect
              x={origin.col * cell}
              y={origin.row * cell}
              width={cell * 6}
              height={cell * 6}
              fill={tone}
            />
            <Rect
              x={(origin.col + 1) * cell}
              y={(origin.row + 1) * cell}
              width={cell * 4}
              height={cell * 4}
              rx={cell * 0.8}
              fill="#FFFFFF"
              fillOpacity={0.93}
            />
            {[0, 1, 2, 3].map((token) => {
              const slot = basePoint(colour, token);
              return (
                <Circle
                  key={`slot-${String(colour)}-${String(token)}`}
                  cx={slot.x * cell}
                  cy={slot.y * cell}
                  r={cell * 0.64}
                  fill={tone}
                  fillOpacity={0.2}
                  stroke={tone}
                  strokeOpacity={0.55}
                  strokeWidth={cell * 0.07}
                />
              );
            })}
          </G>
        );
      })}
      {squares.map((square) => {
        const x = square.col * cell;
        const y = square.row * cell;
        const colour = square.colour;
        const coloured = (square.kind === 'column' || square.start) && colour !== null;
        const fill = coloured ? ludoColors.players[colour] : ludoColors.track;
        if (square.kind === 'home') return null;
        return (
          <Rect
            key={`sq-${String(square.col)}-${String(square.row)}`}
            x={x + cell * 0.02}
            y={y + cell * 0.02}
            width={cell * 0.96}
            height={cell * 0.96}
            rx={cell * 0.12}
            fill={fill}
            stroke={ludoColors.trackLine}
            strokeWidth={cell * 0.05}
            opacity={
              square.kind === 'column' && colour !== null && !activeColours.includes(colour)
                ? 0.35
                : 1
            }
          />
        );
      })}
      {squares
        .filter((square) => square.kind === 'track' && square.safe && !square.start)
        .map((square) => (
          <Polygon
            key={`star-${String(square.col)}-${String(square.row)}`}
            points={starPoints((square.col + 0.5) * cell, (square.row + 0.5) * cell, cell * 0.34)}
            fill={ludoColors.star}
          />
        ))}
      {squares
        .filter((square) => square.kind === 'track' && square.start)
        .map((square) => (
          <Polygon
            key={`start-${String(square.col)}-${String(square.row)}`}
            points={starPoints((square.col + 0.5) * cell, (square.row + 0.5) * cell, cell * 0.32)}
            fill="#FFFFFF"
          />
        ))}
      {/* The centre: one triangle per colour pointing at the middle. */}
      {[
        { colour: 0, points: `${6 * cell},${6 * cell} ${mid},${mid} ${6 * cell},${9 * cell}` },
        { colour: 1, points: `${6 * cell},${6 * cell} ${mid},${mid} ${9 * cell},${6 * cell}` },
        { colour: 2, points: `${9 * cell},${6 * cell} ${mid},${mid} ${9 * cell},${9 * cell}` },
        { colour: 3, points: `${6 * cell},${9 * cell} ${mid},${mid} ${9 * cell},${9 * cell}` },
      ].map((triangle) => (
        <Polygon
          key={`tri-${String(triangle.colour)}`}
          points={triangle.points}
          fill={ludoColors.players[triangle.colour]}
          stroke="#FFFFFF"
          strokeWidth={cell * 0.06}
          opacity={activeColours.includes(triangle.colour) ? 1 : 0.35}
        />
      ))}
      <Circle cx={mid} cy={mid} r={cell * 0.3} fill="#FFFFFF" />
    </Svg>
  );
});

interface TokenProps {
  spot: TokenSpot;
  cell: number;
  canPress: boolean;
  reduced: boolean;
  onPress: (token: number) => void;
}

/** One token. It hops square by square to a new position, or jumps when motion is reduced. */
const TokenView = memo(function TokenView({ spot, cell, canPress, reduced, onPress }: TokenProps) {
  const diameter = cell * 0.78;
  const x = useSharedValue(spot.x * cell);
  const y = useSharedValue(spot.y * cell);
  const scale = useSharedValue(spot.scale);
  const pulse = useSharedValue(1);
  const previous = useRef(spot.position);

  useEffect(() => {
    const from = previous.current;
    previous.current = spot.position;
    const target = { x: spot.x * cell, y: spot.y * cell };
    if (reduced || from === spot.position) {
      x.value = withTiming(target.x, { duration: reduced ? 0 : SETTLE_MS });
      y.value = withTiming(target.y, { duration: reduced ? 0 : SETTLE_MS });
      scale.value = withTiming(spot.scale, { duration: reduced ? 0 : SETTLE_MS });
      return;
    }
    const hops = movePath(from, spot.position).map((position) =>
      tokenPoint(spot.colour, spot.token, position),
    );
    const steps =
      hops.length === 0
        ? [target]
        : [...hops.map((p) => ({ x: p.x * cell, y: p.y * cell })), target];
    const easing = Easing.out(Easing.quad);
    x.value = withSequence(...steps.map((p) => withTiming(p.x, { duration: HOP_MS, easing })));
    y.value = withSequence(...steps.map((p) => withTiming(p.y, { duration: HOP_MS, easing })));
    scale.value = withTiming(spot.scale, { duration: SETTLE_MS });
  }, [
    spot.x,
    spot.y,
    spot.scale,
    spot.position,
    spot.colour,
    spot.token,
    cell,
    reduced,
    x,
    y,
    scale,
  ]);

  useEffect(() => {
    cancelAnimation(pulse);
    if (canPress && !reduced) {
      pulse.value = withRepeat(withTiming(1.18, { duration: 550 }), -1, true);
    } else {
      pulse.value = 1;
    }
  }, [canPress, reduced, pulse]);

  const moving = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value - diameter / 2 },
      { translateY: y.value - diameter / 2 },
      { scale: scale.value },
    ],
  }));
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <Animated.View
      style={[styles.token, { width: diameter, height: diameter }, moving]}
      pointerEvents={canPress ? 'auto' : 'none'}
    >
      <Pressable
        disabled={!canPress}
        hitSlop={Math.max(6, (48 - diameter) / 2)}
        onPress={() => onPress(spot.token)}
        accessibilityRole="button"
        accessibilityLabel={tokenDescription(spot.colour, spot.token, spot.position)}
        accessibilityHint={canPress ? 'Moves this token' : undefined}
        accessibilityState={{ disabled: !canPress }}
        style={styles.fill}
      >
        <Animated.View
          style={[
            styles.disc,
            {
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              backgroundColor: ludoColors.players[spot.colour],
              borderColor: canPress ? '#FFFFFF' : ludoColors.tokenInk,
              borderWidth: canPress ? 3 : 2,
            },
            ring,
          ]}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: diameter * 0.08,
              left: diameter * 0.16,
              width: diameter * 0.3,
              height: diameter * 0.16,
              borderRadius: diameter * 0.1,
              backgroundColor: 'rgba(255,255,255,0.5)',
            }}
          />
          <Text style={[styles.number, { fontSize: diameter * 0.5 }]}>{spot.token + 1}</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
});

export interface LudoBoardProps {
  ludo: LudoView;
  /** Pixel width of the board (it is square). */
  width: number;
  /** Tokens of the viewer that can be tapped now. */
  movable: readonly number[];
  mySeat: number;
  reduced: boolean;
  onTokenPress: (token: number) => void;
}

export function LudoBoard({ ludo, width, movable, mySeat, reduced, onTokenPress }: LudoBoardProps) {
  const cell = width / LUDO_BOARD_SIZE;
  const spots = useMemo(() => layoutTokens(ludo.tokens, ludo.colours), [ludo.tokens, ludo.colours]);
  // Tokens the player can tap are drawn last so they sit on top of any stack.
  const ordered = useMemo(
    () =>
      [...spots].sort((a, b) => {
        const am = a.seat === mySeat && movable.includes(a.token) ? 1 : 0;
        const bm = b.seat === mySeat && movable.includes(b.token) ? 1 : 0;
        return am - bm;
      }),
    [spots, movable, mySeat],
  );
  const mine = ludo.colours[mySeat];
  return (
    <View
      style={[
        styles.frame,
        { width: width + FRAME * 2, height: width + FRAME * 2, padding: FRAME },
      ]}
      accessibilityLabel={`Ludo board. You are ${mine === undefined ? 'a spectator' : colourName(mine)}.`}
    >
      <View style={{ width, height: width, borderRadius: 12, overflow: 'hidden' }}>
        <StaticBoard cell={cell} activeColours={ludo.colours} />
      </View>
      <View style={[StyleSheet.absoluteFill, { padding: FRAME }]} pointerEvents="box-none">
        {ordered.map((spot) => (
          <TokenView
            key={`${String(spot.seat)}-${String(spot.token)}`}
            spot={spot}
            cell={cell}
            canPress={spot.seat === mySeat && movable.includes(spot.token)}
            reduced={reduced}
            onPress={onTokenPress}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'center',
    backgroundColor: ludoColors.frame,
    borderRadius: 22,
    shadowColor: ludoColors.frame,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  token: { position: 'absolute', left: 0, top: 0 },
  fill: { flex: 1 },
  disc: { alignItems: 'center', justifyContent: 'center' },
  number: { color: ludoColors.tokenInk, fontWeight: '800' },
});
