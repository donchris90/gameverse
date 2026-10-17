import { theme } from '@gameverse/design-system';
import {
  canMove,
  canPressReady,
  displayName,
  isOpen,
  myMark,
  opponentOf,
  rematchState,
  resultLines,
  statusLine,
  tappableCells,
  type MatchView,
} from '@gameverse/shared-types';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { chat, games } from '../../src/api-client';
import { ApiError } from '../../src/http';
import { useAction, Body, Button, ErrorText, Loading, Title } from '../../src/ui';
import { useMatch } from '../../src/use-match';

const c = theme.colors;
const s = theme.spacing;

const TONE_COLOR = {
  neutral: c.textPrimary,
  good: c.success,
  bad: c.danger,
  warn: c.warning,
} as const;

function Board({ match, onTap }: { match: MatchView; onTap: (cell: number) => void }) {
  const cells = match.series?.board ?? Array<null>(9).fill(null);
  const open = new Set(tappableCells(match));
  const winLine = new Set(match.series?.winLine ?? []);
  return (
    <View style={styles.board} accessibilityLabel="Game board">
      {cells.map((value, index) => {
        const tappable = open.has(index);
        return (
          <Pressable
            key={index}
            disabled={!tappable}
            onPress={() => onTap(index)}
            accessibilityRole="button"
            accessibilityLabel={`Cell ${String(index + 1)}, ${value ?? 'empty'}`}
            accessibilityState={{ disabled: !tappable }}
            style={[
              styles.cell,
              winLine.has(index) && { borderColor: c.success },
              tappable && { backgroundColor: c.surfaceRaised },
            ]}
          >
            <Text style={[styles.mark, value === 'O' && { color: c.accentBlue }]}>
              {value ?? ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { match, error, apply, refresh, deadlineSeconds } = useMatch(id);
  const act = useAction();
  const pendingMove = useRef<{ cell: number; version: number; clientActionId: string } | null>(
    null,
  );

  // A rematch (or the next match) opens by itself when the server says it exists.
  const rematchId = match?.rematchMatchId ?? null;
  useEffect(() => {
    if (rematchId) router.replace({ pathname: '/match/[id]', params: { id: rematchId } });
  }, [rematchId, router]);

  if (!match) {
    return <View style={styles.screen}>{error ? <ErrorText error={error} /> : <Loading />}</View>;
  }

  const status = statusLine(match, deadlineSeconds);
  const opponent = opponentOf(match);
  const mark = myMark(match);
  const lines = resultLines(match);
  const rematch = rematchState(match);

  const onTap = (cell: number) => {
    if (!canMove(match)) return;
    // The same cell on the same version reuses its action id, so a retry can never double-apply.
    const previous = pendingMove.current;
    const reuse = previous && previous.cell === cell && previous.version === match.version;
    const move = reuse
      ? previous
      : { cell, version: match.version, clientActionId: Crypto.randomUUID() };
    pendingMove.current = move;
    void act.run(async () => {
      try {
        apply(await games.move(match.id, move.cell, move.clientActionId, move.version));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) await refresh();
        else throw err;
      }
    });
  };

  const openChat = () => {
    if (opponent.userId === null) return;
    const userId = opponent.userId;
    void act.run(async () => {
      const conversation = await chat.open(userId);
      router.push({ pathname: '/chat/[id]', params: { id: conversation.id } });
    });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Title>{match.kind === 'BOT' ? 'Practice match' : 'Tic-tac-toe'}</Title>
      <Text style={styles.versus}>
        You{mark ? ` (${mark})` : ''} vs {displayName(opponent)}
        {opponent.bot !== null ? ' · computer player' : ''}
      </Text>

      <View accessibilityLiveRegion="polite">
        <Text style={[styles.headline, { color: TONE_COLOR[status.tone] }]}>{status.headline}</Text>
        {status.detail ? <Body muted>{status.detail}</Body> : null}
      </View>

      <Board match={match} onTap={onTap} />
      <ErrorText error={act.error} />

      {canPressReady(match) ? (
        <Button
          label="Ready"
          busy={act.busy}
          onPress={() => void act.run(async () => apply(await games.ready(match.id)))}
        />
      ) : null}

      {lines ? (
        <View style={styles.result}>
          {lines.rating ? <Body>{lines.rating}</Body> : null}
          {lines.xp ? <Body>{lines.xp}</Body> : null}
        </View>
      ) : null}

      {match.status === 'COMPLETED' ? (
        <>
          {rematch === 'available' ? (
            <Button
              label="Rematch"
              busy={act.busy}
              onPress={() => void act.run(async () => apply(await games.rematch(match.id)))}
            />
          ) : null}
          {rematch === 'waiting' ? (
            <Body muted>Rematch requested. Waiting for {displayName(opponent)}…</Body>
          ) : null}
          <Button
            label="Back to games"
            tone="secondary"
            onPress={() => router.replace('/(tabs)/play')}
          />
        </>
      ) : null}

      {opponent.userId !== null ? (
        <Button label={`Chat with ${opponent.username}`} tone="secondary" onPress={openChat} />
      ) : null}

      {isOpen(match) ? (
        <Button
          label={match.status === 'ACTIVE' ? 'Leave match (you lose)' : 'Leave'}
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
  content: { padding: s.lg },
  versus: { color: c.textSecondary, fontSize: 15, marginBottom: s.md },
  headline: { fontSize: 22, fontWeight: '700', marginBottom: s.xs },
  board: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 288,
    alignSelf: 'center',
    marginVertical: s.lg,
  },
  cell: {
    width: 96,
    height: 96,
    borderWidth: 2,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface,
  },
  mark: { fontSize: 48, fontWeight: '800', color: c.accentCoral },
  result: { marginBottom: s.md },
});
