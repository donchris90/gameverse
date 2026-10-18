import { theme } from '@gameverse/design-system';
import {
  canPressReady,
  displayName,
  draughtsCanMove,
  draughtsCounts,
  draughtsDrawOrder,
  draughtsMovable,
  draughtsStatus,
  draughtsStep,
  isOpen,
  leaveLabel,
  pieceName,
  rematchState,
  resultLines,
  squareName,
  type MatchView,
} from '@gameverse/shared-types';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { chat, games } from '../api-client';
import { ApiError } from '../http';
import { Body, Button, ErrorText, Title, useAction } from '../ui';
import { VoicePanel } from '../VoicePanel';

const c = theme.colors;
const s = theme.spacing;

const TONE_COLOR = {
  neutral: c.textPrimary,
  good: c.success,
  bad: c.danger,
  warn: c.warning,
} as const;

// Fixed so the two sides can always be told apart, whatever the app theme is.
const BOARD_DARK = '#6B4A2B';
const BOARD_LIGHT = '#E8D3B0';
const SIDE_COLOUR = ['#F4EBD9', '#B3261E'] as const;
const SIDE_RIM = ['#8A7A5C', '#5E0F0B'] as const;

function Piece({ cell, size }: { cell: number; size: number }) {
  if (cell === 0) return null;
  const side = cell <= 2 ? 0 : 1;
  const isKing = cell === 2 || cell === 4;
  const diameter = size * 0.74;
  return (
    <View
      style={{
        width: diameter,
        height: diameter,
        borderRadius: diameter / 2,
        backgroundColor: SIDE_COLOUR[side],
        borderWidth: 3,
        borderColor: SIDE_RIM[side],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isKing ? (
        <View
          style={{
            width: diameter * 0.5,
            height: diameter * 0.5,
            borderRadius: diameter * 0.25,
            borderWidth: 3,
            borderColor: SIDE_RIM[side],
            backgroundColor: side === 0 ? '#E6B422' : '#F2C94C',
          }}
        />
      ) : null}
    </View>
  );
}

function tap(style: Haptics.ImpactFeedbackStyle) {
  // Haptics are a nicety; a phone without them must not break the game.
  void Haptics.impactAsync(style).catch(() => undefined);
}

/** The Draughts match screen. The server decides everything; this only shows it and sends taps. */
export function DraughtsMatch({
  match,
  apply,
  refresh,
  deadlineSeconds,
}: {
  match: MatchView;
  apply: (match: MatchView) => void;
  refresh: () => Promise<void>;
  deadlineSeconds: number | null;
}) {
  const router = useRouter();
  const act = useAction();
  const { width } = useWindowDimensions();
  const pending = useRef<{ key: string; version: number; id: string } | null>(null);
  const [from, setFrom] = useState<number | null>(null);
  const [path, setPath] = useState<number[]>([]);

  const game = match.draughts;
  // A new position means any half-entered move is out of date.
  useEffect(() => {
    setFrom(null);
    setPath([]);
  }, [match.version]);

  const boardSize = Math.min(width - s.lg * 2, 460);
  const cellSize = boardSize / 8;
  const status = draughtsStatus(match, deadlineSeconds);
  const canMove = draughtsCanMove(match);
  const movable = new Set(draughtsMovable(match));
  const step = game && from !== null ? draughtsStep(game.moves, from, path) : null;
  const targets = new Set(step?.next ?? []);
  const lastSquares = new Set(game?.last ? [game.last.from, ...game.last.path] : []);
  const counts = game ? draughtsCounts(game) : [0, 0];
  const lines = resultLines(match);
  const rematch = rematchState(match);
  const humans = match.players.filter(
    (player) => player.seat !== match.mySeat && player.userId !== null,
  );

  const send = (moveFrom: number, movePath: number[]) => {
    // The same move on the same version reuses its action id, so a retry cannot play twice.
    const key = `${String(moveFrom)}:${movePath.join(',')}`;
    const previous = pending.current;
    const attempt =
      previous && previous.key === key && previous.version === match.version
        ? previous
        : { key, version: match.version, id: Crypto.randomUUID() };
    pending.current = attempt;
    tap(Haptics.ImpactFeedbackStyle.Medium);
    void act.run(async () => {
      try {
        apply(await games.moveDraughts(match.id, moveFrom, movePath, attempt.id, attempt.version));
      } catch (err) {
        // The match moved on without us (a timeout, another tap): show the server's version.
        if (err instanceof ApiError && err.status === 409) await refresh();
        else throw err;
      }
    });
  };

  const onSquare = (square: number) => {
    if (!canMove || !game) return;
    if (from === null || (path.length === 0 && movable.has(square) && square !== from)) {
      if (movable.has(square)) {
        tap(Haptics.ImpactFeedbackStyle.Light);
        setFrom(square);
        setPath([]);
      }
      return;
    }
    if (path.length === 0 && square === from) {
      setFrom(null);
      return;
    }
    if (!targets.has(square)) return;
    const nextPath = [...path, square];
    const result = draughtsStep(game.moves, from, nextPath);
    if (result.complete) {
      send(from, nextPath);
      setFrom(null);
      setPath([]);
    } else {
      tap(Haptics.ImpactFeedbackStyle.Light);
      setPath(nextPath);
    }
  };

  const openChat = (userId: string) =>
    void act.run(async () => {
      const conversation = await chat.open(userId);
      router.push({ pathname: '/chat/[id]', params: { id: conversation.id } });
    });

  if (!game) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Title>Draughts</Title>
        <Text style={[styles.headline, { color: TONE_COLOR[status.tone] }]}>{status.headline}</Text>
        {status.detail ? <Body muted>{status.detail}</Body> : null}
        {canPressReady(match) ? (
          <Button
            label="Ready"
            busy={act.busy}
            onPress={() => void act.run(async () => apply(await games.ready(match.id)))}
          />
        ) : null}
        {isOpen(match) ? (
          <Button
            label={leaveLabel(match)}
            tone="danger"
            busy={act.busy}
            onPress={() =>
              void act.run(async () => {
                apply(await games.leave(match.id));
                router.replace('/(tabs)/play');
              })
            }
          />
        ) : null}
        <ErrorText error={act.error} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Title>{match.kind === 'BOT' ? 'Practice match' : 'Draughts'}</Title>

      <View style={styles.legend} accessibilityLabel="Players">
        {match.players.map((player) => (
          <View
            key={player.seat}
            style={[styles.chip, game.toMove === player.seat && { borderColor: c.success }]}
            accessibilityLabel={`${player.seat === match.mySeat ? 'You' : displayName(player)}, ${String(
              counts[player.seat] ?? 0,
            )} pieces${game.toMove === player.seat ? ', their move' : ''}${
              player.connected ? '' : ', disconnected'
            }`}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: SIDE_COLOUR[player.seat === 0 ? 0 : 1],
                  borderColor: SIDE_RIM[player.seat === 0 ? 0 : 1],
                },
              ]}
            />
            <View style={styles.flex}>
              <Text style={styles.chipName} numberOfLines={1}>
                {player.seat === match.mySeat ? 'You' : displayName(player)}
              </Text>
              <Text style={styles.chipMeta}>
                {player.connected ? `${String(counts[player.seat] ?? 0)} pieces` : 'offline'}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <View accessibilityLiveRegion="polite">
        <Text style={[styles.headline, { color: TONE_COLOR[status.tone] }]}>{status.headline}</Text>
        {status.detail ? <Body muted>{status.detail}</Body> : null}
      </View>

      <View style={styles.boardWrap}>
        <View
          accessibilityLabel="Draughts board"
          style={[styles.board, { width: boardSize, height: boardSize }]}
        >
          {draughtsDrawOrder(match.mySeat).map((square, index) => {
            const dark = (Math.floor(square / 8) + (square % 8)) % 2 === 1;
            const cell = game.board[square] ?? 0;
            const selectable =
              canMove && (from === null || path.length === 0) && movable.has(square);
            const isTarget = targets.has(square);
            const highlight = square === from || (path.length > 0 && path.includes(square));
            return (
              <Pressable
                key={index}
                disabled={!dark || (!selectable && !isTarget && square !== from)}
                onPress={() => onSquare(square)}
                accessibilityRole="button"
                accessibilityLabel={`${squareName(square)}, ${pieceName(cell)}${
                  isTarget ? ', move here' : ''
                }${selectable ? ', can move' : ''}`}
                style={[
                  styles.square,
                  { width: cellSize, height: cellSize },
                  { backgroundColor: dark ? BOARD_DARK : BOARD_LIGHT },
                  lastSquares.has(square) && dark && styles.last,
                  highlight && styles.selected,
                ]}
              >
                <Piece cell={cell} size={cellSize} />
                {isTarget ? <View style={styles.target} /> : null}
                {selectable && cell !== 0 && from === null ? <View style={styles.hint} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      {game.sinceProgress >= 60 && game.phase === 'playing' ? (
        <Body muted>
          Draw in {String(Math.max(0, 80 - game.sinceProgress))} moves unless a piece is captured or
          a man moves.
        </Body>
      ) : null}
      <ErrorText error={act.error} />

      {canPressReady(match) ? (
        <Button
          label="Ready"
          busy={act.busy}
          onPress={() => void act.run(async () => apply(await games.ready(match.id)))}
        />
      ) : null}

      {match.status === 'COMPLETED' ? (
        <>
          <View style={styles.result} accessibilityLabel="Result">
            {lines?.rating ? <Body>{lines.rating}</Body> : null}
            {lines?.xp ? <Body>{lines.xp}</Body> : null}
          </View>
          {rematch === 'available' ? (
            <Button
              label="Rematch"
              busy={act.busy}
              onPress={() => void act.run(async () => apply(await games.rematch(match.id)))}
            />
          ) : null}
          {rematch === 'waiting' ? <Body muted>Rematch requested. Waiting for them…</Body> : null}
          <Button
            label="Back to games"
            tone="secondary"
            onPress={() => router.replace('/(tabs)/play')}
          />
        </>
      ) : null}

      <VoicePanel match={match} />

      {humans.map((player) => (
        <Button
          key={player.seat}
          label={`Chat with ${displayName(player)}`}
          tone="secondary"
          onPress={() => openChat(player.userId ?? '')}
        />
      ))}

      {isOpen(match) ? (
        <Button
          label={leaveLabel(match)}
          tone="danger"
          busy={act.busy}
          onPress={() =>
            void act.run(async () => {
              apply(await games.leave(match.id));
              router.replace('/(tabs)/play');
            })
          }
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  content: { padding: s.lg, paddingBottom: s.xxl },
  flex: { flex: 1 },
  legend: { flexDirection: 'row', gap: s.sm, marginBottom: s.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s.sm,
    flex: 1,
    padding: s.sm,
    borderRadius: theme.radii.sm,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 3 },
  chipName: { color: c.textPrimary, fontSize: 15, fontWeight: '600' },
  chipMeta: { color: c.textSecondary, fontSize: 13 },
  headline: { fontSize: 20, fontWeight: '700', marginBottom: s.xs },
  boardWrap: { alignItems: 'center', marginVertical: s.md },
  board: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 3,
    borderColor: '#3E2A16',
    borderRadius: 4,
    overflow: 'hidden',
  },
  square: { alignItems: 'center', justifyContent: 'center' },
  last: { backgroundColor: '#8A6A3D' },
  selected: { backgroundColor: '#3F7D4E' },
  target: {
    position: 'absolute',
    width: '34%',
    height: '34%',
    borderRadius: 99,
    backgroundColor: '#3F7D4E',
    opacity: 0.9,
  },
  hint: {
    position: 'absolute',
    bottom: 3,
    width: '24%',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3F7D4E',
  },
  result: { marginBottom: s.md },
});
