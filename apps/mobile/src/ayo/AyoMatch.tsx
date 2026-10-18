import { theme } from '@gameverse/design-system';
import {
  ayoEndControl,
  ayoMovable,
  ayoOwnPits,
  ayoReplayFrames,
  ayoRoundNote,
  ayoRows,
  ayoStatus,
  canPressReady,
  displayName,
  isOpen,
  leaveLabel,
  rematchState,
  resultLines,
  type MatchView,
} from '@gameverse/shared-types';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { chat, games } from '../api-client';
import { ApiError } from '../http';
import { useReduceMotion } from '../ludo/motion';
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
const WOOD = '#6B4A2B';
const WOOD_DARK = '#3E2A16';
const PIT = '#2B1B0D';
const SEED = '#F4EBD9';
const MINE = '#3F7D4E';
const THEIRS = '#B3261E';
const FRAME_MS = 140;

function tap(style: Haptics.ImpactFeedbackStyle) {
  // Haptics are a nicety; a phone without them must not break the game.
  void Haptics.impactAsync(style).catch(() => undefined);
}

/** The Ayo match screen. The server decides everything; this only shows it and sends taps. */
export function AyoMatch({
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
  const { reduced } = useReduceMotion();
  const pending = useRef<{ key: string; version: number; id: string } | null>(null);
  const previous = useRef<{ version: number; pits: number[] } | null>(null);
  const [replay, setReplay] = useState<{ pits: number[]; focus: number } | null>(null);

  const game = match.ayo;

  // Replay the last turn seed by seed, then settle on the real board.
  useEffect(() => {
    if (!game) return;
    const before = previous.current;
    previous.current = { version: match.version, pits: [...game.pits] };
    if (reduced || !before || before.version >= match.version || !game.last) {
      setReplay(null);
      return;
    }
    const steps = game.last.steps;
    if (steps.length > 220) {
      setReplay(null);
      return;
    }
    const frames = ayoReplayFrames(before.pits, steps);
    let index = 0;
    setReplay({ pits: frames[0] ?? before.pits, focus: steps[0]?.pit ?? -1 });
    const timer = setInterval(() => {
      index += 1;
      if (index >= frames.length) {
        clearInterval(timer);
        setReplay(null);
        return;
      }
      setReplay({ pits: frames[index] as number[], focus: steps[index]?.pit ?? -1 });
    }, FRAME_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.version]);

  const status = ayoStatus(match, deadlineSeconds);
  const movable = new Set(ayoMovable(match));
  const own = new Set(ayoOwnPits(match.mySeat));
  const rows = ayoRows(match.mySeat);
  const shown = replay?.pits ?? game?.pits ?? [];
  const pitSize = Math.min((width - s.lg * 2 - 6 * 6) / 6, 64);
  const note = ayoRoundNote(match);
  const endControl = ayoEndControl(match);
  const lines = resultLines(match);
  const rematch = rematchState(match);
  const humans = match.players.filter(
    (player) => player.seat !== match.mySeat && player.userId !== null,
  );
  const meSeat: 0 | 1 = match.mySeat === 0 ? 0 : 1;
  const opponentSeat: 0 | 1 = meSeat === 0 ? 1 : 0;

  const send = (key: string, work: (id: string, version: number) => Promise<MatchView>) => {
    // The same action on the same version reuses its id, so a retry cannot play twice.
    const before = pending.current;
    const attempt =
      before && before.key === key && before.version === match.version
        ? before
        : { key, version: match.version, id: Crypto.randomUUID() };
    pending.current = attempt;
    void act.run(async () => {
      try {
        apply(await work(attempt.id, attempt.version));
      } catch (err) {
        // The match moved on without us (a timeout, another tap): show the server's version.
        if (err instanceof ApiError && err.status === 409) await refresh();
        else throw err;
      }
    });
  };

  const onPit = (pit: number) => {
    if (!movable.has(pit) || replay) return;
    tap(Haptics.ImpactFeedbackStyle.Medium);
    send(`pit:${String(pit)}`, (id, version) => games.moveAyo(match.id, pit, id, version));
  };

  const onEnd = (action: 'offer' | 'accept' | 'decline') => {
    tap(Haptics.ImpactFeedbackStyle.Light);
    send(`end:${action}`, (id, version) => games.endAyo(match.id, action, id, version));
  };

  const openChat = (userId: string) =>
    void act.run(async () => {
      const conversation = await chat.open(userId);
      router.push({ pathname: '/chat/[id]', params: { id: conversation.id } });
    });

  const renderPit = (pit: number) => {
    const alive = game?.alive[pit] ?? false;
    const count = shown[pit] ?? 0;
    const canTap = movable.has(pit) && !replay;
    const theirs = !own.has(pit);
    return (
      <Pressable
        key={pit}
        disabled={!canTap}
        onPress={() => onPit(pit)}
        accessibilityRole="button"
        accessibilityLabel={
          alive
            ? `${own.has(pit) ? 'Your' : 'Their'} pit ${String(pit + 1)}, ${String(count)} seeds${
                canTap ? ', tap to play' : ''
              }`
            : `Pit ${String(pit + 1)}, out of the game`
        }
        accessibilityState={{ disabled: !canTap }}
        style={[
          styles.pit,
          { width: pitSize, height: pitSize, borderRadius: pitSize / 2 },
          !alive && styles.dead,
          alive && { borderColor: theirs ? THEIRS : MINE },
          canTap && styles.canTap,
          replay?.focus === pit && styles.focus,
        ]}
      >
        {alive ? <Text style={[styles.count, count === 0 && styles.zero]}>{count}</Text> : null}
      </Pressable>
    );
  };

  if (!game) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Title>Ayo</Title>
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

  const opponent = match.players.find((player) => player.seat === opponentSeat);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Title>{match.kind === 'BOT' ? 'Practice match' : 'Ayo'}</Title>

      <View style={styles.legend} accessibilityLabel="Players">
        {[opponentSeat, meSeat].map((seat) => {
          const player = match.players.find((candidate) => candidate.seat === seat);
          return (
            <View
              key={seat}
              style={[styles.chip, game.toMove === seat && { borderColor: c.success }]}
              accessibilityLabel={`${seat === meSeat ? 'You' : player ? displayName(player) : 'Opponent'}, ${String(
                game.stores[seat] ?? 0,
              )} seeds reaped${game.toMove === seat ? ', their move' : ''}`}
            >
              <View style={styles.flex}>
                <Text style={styles.chipName} numberOfLines={1}>
                  {seat === meSeat ? 'You' : player ? displayName(player) : 'Opponent'}
                </Text>
                <Text style={styles.chipMeta}>
                  {String(game.stores[seat] ?? 0)} reaped · {String(game.totals[seat] ?? 0)} in all
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <Text style={styles.round}>Round {game.round}</Text>
      {note ? <Body muted>{note}</Body> : null}
      <View accessibilityLiveRegion="polite">
        <Text style={[styles.headline, { color: TONE_COLOR[status.tone] }]}>{status.headline}</Text>
        {status.detail ? <Body muted>{status.detail}</Body> : null}
      </View>

      <View style={styles.board} accessibilityLabel="Ayo board">
        <Text style={styles.sideLabel}>{opponent ? displayName(opponent) : 'Opponent'}</Text>
        <View style={styles.row}>{rows.top.map(renderPit)}</View>
        <View style={styles.row}>{rows.bottom.map(renderPit)}</View>
        <Text style={styles.sideLabel}>You</Text>
      </View>

      {endControl === 'offer' ? (
        <Button
          label="Offer to end the game"
          tone="secondary"
          busy={act.busy}
          onPress={() => onEnd('offer')}
        />
      ) : null}
      {endControl === 'answer' ? (
        <View style={styles.offer}>
          <Body>They offered to end the game. The bigger total wins.</Body>
          <Button label="Accept" busy={act.busy} onPress={() => onEnd('accept')} />
          <Button
            label="Decline"
            tone="secondary"
            busy={act.busy}
            onPress={() => onEnd('decline')}
          />
        </View>
      ) : null}
      {endControl === 'waiting' ? (
        <Body muted>You offered to end the game. Waiting for them…</Body>
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
            <Body>
              Final count: you {String(game.totals[meSeat] ?? 0)}, them{' '}
              {String(game.totals[opponentSeat] ?? 0)}
            </Body>
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
  legend: { flexDirection: 'row', gap: s.sm, marginBottom: s.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    padding: s.sm,
    borderRadius: theme.radii.sm,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  chipName: { color: c.textPrimary, fontSize: 15, fontWeight: '600' },
  chipMeta: { color: c.textSecondary, fontSize: 13 },
  round: { color: c.textSecondary, fontSize: 14, marginBottom: s.xs },
  headline: { fontSize: 20, fontWeight: '700', marginBottom: s.xs },
  board: {
    backgroundColor: WOOD,
    borderWidth: 3,
    borderColor: WOOD_DARK,
    borderRadius: 12,
    padding: s.sm,
    marginVertical: s.md,
    gap: 6,
  },
  sideLabel: { color: SEED, fontSize: 13, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  pit: {
    backgroundColor: PIT,
    borderWidth: 3,
    borderColor: WOOD_DARK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dead: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderColor: '#8A6A3D',
    opacity: 0.45,
  },
  canTap: { borderColor: '#9BE3AE', backgroundColor: '#1F3A26' },
  focus: { backgroundColor: '#5B3D1B' },
  count: { color: SEED, fontSize: 22, fontWeight: '800' },
  zero: { opacity: 0.35 },
  offer: { gap: s.sm, marginBottom: s.md },
  result: { marginBottom: s.md },
});
