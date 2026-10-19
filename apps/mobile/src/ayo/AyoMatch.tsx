import { theme } from '@gameverse/design-system';
import {
  ayoEndControl,
  ayoMovable,
  ayoReplayTimeline,
  ayoRoundNote,
  ayoStatus,
  canPressReady,
  displayName,
  isOpen,
  leaveLabel,
  rematchState,
  entrySummary,
  resultLines,
  type MatchView,
} from '@gameverse/shared-types';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { chat, games } from '../api-client';
import { ApiError } from '../http';
import { useReduceMotion } from '../ludo/motion';
import { Body, Button, ErrorText, Title, useAction } from '../ui';
import { VoicePanel } from '../VoicePanel';
import { AyoTable } from './AyoTable';
import { AYO } from './theme';

const c = theme.colors;
const s = theme.spacing;

const TONE_COLOR = {
  neutral: c.textPrimary,
  good: c.success,
  bad: c.danger,
  warn: c.warning,
} as const;

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
  const previous = useRef<{ version: number; pits: number[]; stores: [number, number] } | null>(
    null,
  );
  const [replay, setReplay] = useState<{
    pits: number[];
    stores: [number, number];
    focus: number;
    hand: number;
    trail: number[];
  } | null>(null);

  const game = match.ayo;

  // Replay the last turn seed by seed (lift, drop, reap), then settle on the real board.
  useEffect(() => {
    if (!game) return;
    const before = previous.current;
    previous.current = { version: match.version, pits: [...game.pits], stores: [...game.stores] };
    if (reduced || !before || before.version >= match.version || !game.last) {
      setReplay(null);
      return;
    }
    const steps = game.last.steps;
    if (steps.length > 400) {
      setReplay(null);
      return;
    }
    const frames = ayoReplayTimeline(before.pits, before.stores, steps);
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      const frame = frames[index];
      if (!frame) {
        setReplay(null);
        return;
      }
      setReplay({
        pits: frame.pits,
        stores: frame.stores,
        focus: frame.focus,
        hand: frame.hand,
        trail: frame.trail,
      });
      if (frame.kind === 'reap') tap(Haptics.ImpactFeedbackStyle.Medium);
      index += 1;
      timer = setTimeout(show, frame.ms);
    };
    show();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.version]);

  const status = ayoStatus(match, deadlineSeconds);
  const movable = new Set(ayoMovable(match));
  const shown = replay?.pits ?? game?.pits ?? [];
  const shownStores = replay?.stores ?? game?.stores ?? [0, 0];
  const note = ayoRoundNote(match);
  const endControl = ayoEndControl(match);
  const lines = resultLines(match);
  const coinLine = entrySummary(match);
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
                shownStores[seat] ?? 0,
              )} seeds reaped${game.toMove === seat ? ', their move' : ''}`}
            >
              <View style={styles.flex}>
                <Text style={styles.chipName} numberOfLines={1}>
                  {seat === meSeat ? 'You' : player ? displayName(player) : 'Opponent'}
                </Text>
                <Text style={styles.chipMeta}>
                  {String(shownStores[seat] ?? 0)} reaped · {String(game.totals[seat] ?? 0)} in all
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {coinLine && match.status !== 'COMPLETED' ? <Body muted>{coinLine}</Body> : null}
      {note ? <Body muted>{note}</Body> : null}
      <View accessibilityLiveRegion="polite">
        <Text style={[styles.headline, { color: TONE_COLOR[status.tone] }]}>{status.headline}</Text>
        {status.detail ? <Body muted>{status.detail}</Body> : null}
      </View>

      {replay ? (
        <Text style={styles.hand} accessibilityLiveRegion="polite">
          {replay.hand > 0 ? `Sowing · ${String(replay.hand)} in hand` : 'Sowing…'}
        </Text>
      ) : null}

      <AyoTable
        mySeat={match.mySeat}
        pits={shown}
        alive={game.alive}
        movable={movable}
        hot={replay ? replay.focus : null}
        trail={replay?.trail ?? []}
        replaying={replay !== null}
        width={Math.min(width - s.lg * 2, 420)}
        opponentName={opponent ? displayName(opponent) : 'Opponent'}
        roundLabel={`ROUND ${String(game.round)}`}
        onPit={onPit}
      />

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
            {coinLine ? <Body>{coinLine}</Body> : null}
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
  screen: { flex: 1, backgroundColor: AYO.bg },
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
    borderColor: AYO.border,
    backgroundColor: AYO.surface,
  },
  chipName: { color: AYO.text, fontSize: 15, fontWeight: '700' },
  chipMeta: { color: AYO.muted, fontSize: 13 },
  hand: {
    color: AYO.gold,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.6,
  },
  headline: { fontSize: 20, fontWeight: '700', marginBottom: s.xs },
  offer: { gap: s.sm, marginBottom: s.md },
  result: { marginBottom: s.md },
});
