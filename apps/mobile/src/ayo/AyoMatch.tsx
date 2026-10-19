import { theme } from '@gameverse/design-system';
import {
  ayoDecisionControl,
  ayoMovable,
  ayoPitCounts,
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
  type AyoView,
  type MatchView,
  type PlayerSeat,
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
  const [replay, setReplay] = useState<{
    pits: number[];
    owners: PlayerSeat[];
    packed: [number, number];
    focus: number;
    hand: number;
    trail: number[];
    note: string | null;
  } | null>(null);

  const game = match.ayo;
  const meSeat: 0 | 1 = match.mySeat === 0 ? 0 : 1;
  const opponentSeat: 0 | 1 = meSeat === 0 ? 1 : 0;

  // Every move (yours, theirs, the bot's) is replayed seed by seed from the server's own record of
  // it, one after the other, then the real board shows. A move that arrives while another is still
  // being shown waits its turn, so no move is skipped or run together with another.
  const seenPlies = useRef(game?.plies ?? 0);
  const queue = useRef<NonNullable<AyoView['last']>[]>([]);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const noteFor = (kind: string, by: number | null, amount: number, round: number | null) => {
    if (round !== null) return `Round ${String(round)}`;
    const who = by === meSeat ? 'You' : 'They';
    if (kind === 'pack') return `${who} packed ${String(amount)}`;
    if (kind === 'final') return `The last ${String(amount)} seeds go to ${who.toLowerCase()}`;
    return null;
  };

  const drain = async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (alive.current && queue.current.length > 0) {
        const move = queue.current.shift();
        if (!move) break;
        const frames = ayoReplayTimeline(move.before, move.steps);
        for (let index = 0; index < frames.length && alive.current; index += 1) {
          const frame = frames[index];
          const step = move.steps[index];
          if (!frame || !step) break;
          const by = step.k === 'pack' || step.k === 'final' ? step.by : null;
          const amount = step.k === 'pack' || step.k === 'final' ? step.amount : 0;
          setReplay({
            pits: frame.pits,
            owners: frame.owners,
            packed: frame.packed,
            focus: frame.focus,
            hand: frame.hand,
            trail: frame.trail,
            note: noteFor(frame.kind, by, amount, frame.round),
          });
          if (frame.kind === 'pack') tap(Haptics.ImpactFeedbackStyle.Medium);
          await new Promise<void>((resolve) => setTimeout(resolve, frame.ms));
        }
      }
    } finally {
      running.current = false;
      if (alive.current) setReplay(null);
    }
  };

  useEffect(() => {
    if (!game?.last || game.plies <= seenPlies.current) return;
    seenPlies.current = game.plies;
    if (reduced || game.last.steps.length > 400) return;
    queue.current.push(game.last);
    void drain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.plies]);

  const status = ayoStatus(match, deadlineSeconds);
  const movable = new Set(ayoMovable(match));
  const shown = replay?.pits ?? game?.pits ?? [];
  const shownPacked = replay?.packed ?? game?.packed ?? [0, 0];
  const shownOwners = replay?.owners ?? game?.owners ?? [];
  const pitCounts = ayoPitCounts(shownOwners);
  const note = ayoRoundNote(match);
  const decisionControl = ayoDecisionControl(match);
  const lines = resultLines(match);
  const coinLine = entrySummary(match);
  const rematch = rematchState(match);
  const humans = match.players.filter(
    (player) => player.seat !== match.mySeat && player.userId !== null,
  );

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

  const onDecide = (quit: boolean) => {
    tap(Haptics.ImpactFeedbackStyle.Light);
    send(`decide:${String(quit)}`, (id, version) => games.decideAyo(match.id, quit, id, version));
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
                shownPacked[seat] ?? 0,
              )} seeds packed, ${String(pitCounts[seat] ?? 0)} pits${game.toMove === seat ? ', their move' : ''}`}
            >
              <View style={styles.flex}>
                <Text style={styles.chipName} numberOfLines={1}>
                  {seat === meSeat ? 'You' : player ? displayName(player) : 'Opponent'}
                </Text>
                <Text style={styles.chipMeta}>
                  {String(shownPacked[seat] ?? 0)} packed · {String(pitCounts[seat] ?? 0)} pits
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
          {replay.hand > 0 ? `${String(replay.hand)} in hand` : 'Sowing…'}
        </Text>
      ) : null}

      <AyoTable
        mySeat={match.mySeat}
        pits={shown}
        owners={shownOwners}
        movable={movable}
        hot={replay ? replay.focus : null}
        trail={replay?.trail ?? []}
        replaying={replay !== null}
        width={Math.min(width - s.lg * 2, 420)}
        opponentName={opponent ? displayName(opponent) : 'Opponent'}
        roundLabel={`ROUND ${String(game.round)}`}
        banner={replay?.note ?? null}
        onPit={onPit}
      />

      {decisionControl === 'choose' && !replay ? (
        <View style={styles.offer}>
          <Body>You started this round with one pit. Quit and lose, or keep playing?</Body>
          <Button label="Keep playing" busy={act.busy} onPress={() => onDecide(false)} />
          <Button
            label="Quit (you lose)"
            tone="danger"
            busy={act.busy}
            onPress={() => onDecide(true)}
          />
        </View>
      ) : null}
      {decisionControl === 'waiting' && !replay ? (
        <Body muted>They started this round with one pit and are choosing…</Body>
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
            {game.lastRound ? (
              <Body>
                Last round: you packed {String(game.lastRound.packed[meSeat])} (
                {String(game.lastRound.pits[meSeat])} pits), they packed{' '}
                {String(game.lastRound.packed[opponentSeat])} (
                {String(game.lastRound.pits[opponentSeat])} pits)
              </Body>
            ) : null}
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
