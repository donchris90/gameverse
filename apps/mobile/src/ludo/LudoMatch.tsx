import { ludoColors, theme } from '@gameverse/design-system';
import {
  displayName,
  iAmOut,
  leaveLabel,
  ludoCanRoll,
  ludoEventTexts,
  ludoMovableTokens,
  ludoStatus,
  placingRows,
  rematchState,
  entrySummary,
  resultLines,
  seatSummaries,
  shownDie,
  isOpen,
  canPressReady,
  type MatchView,
} from '@gameverse/shared-types';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { chat, games } from '../api-client';
import { ApiError } from '../http';
import { Body, Button, ErrorText, Title, useAction } from '../ui';
import { VoicePanel } from '../VoicePanel';
import { Dice } from './Dice';
import { LudoBoard } from './LudoBoard';
import { useReduceMotion } from './motion';

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

/** The Ludo match screen. The server decides everything; this only shows it and sends taps. */
export function LudoMatch({
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
  const pendingRoll = useRef<{ version: number; id: string } | null>(null);
  const pendingMove = useRef<{ token: number; version: number; id: string } | null>(null);

  const ludo = match.ludo;
  const boardWidth = Math.min(width - s.lg * 2, 460);
  const status = ludoStatus(match, deadlineSeconds);
  const movable = ludoMovableTokens(match);
  const canRoll = ludoCanRoll(match);
  const seats = seatSummaries(match);
  const ticker = ludoEventTexts(match).slice(-3);
  const lines = resultLines(match);
  const coinLine = entrySummary(match);
  const rematch = rematchState(match);
  const humans = match.players.filter(
    (player) => player.seat !== match.mySeat && player.userId !== null,
  );

  const send = (work: () => Promise<MatchView>) =>
    act.run(async () => {
      try {
        apply(await work());
      } catch (err) {
        // The match moved on without us (a timeout, another tap): show the server's version.
        if (err instanceof ApiError && err.status === 409) await refresh();
        else throw err;
      }
    });

  const onRoll = () => {
    if (!canRoll) return;
    // The same roll on the same version reuses its action id, so a retry cannot roll twice.
    const previous = pendingRoll.current;
    const attempt =
      previous && previous.version === match.version
        ? previous
        : { version: match.version, id: Crypto.randomUUID() };
    pendingRoll.current = attempt;
    tap(Haptics.ImpactFeedbackStyle.Medium);
    void send(() => games.roll(match.id, attempt.id, attempt.version));
  };

  const onToken = (token: number) => {
    if (!movable.includes(token)) return;
    const previous = pendingMove.current;
    const attempt =
      previous && previous.token === token && previous.version === match.version
        ? previous
        : { token, version: match.version, id: Crypto.randomUUID() };
    pendingMove.current = attempt;
    tap(Haptics.ImpactFeedbackStyle.Light);
    void send(() => games.moveToken(match.id, token, attempt.id, attempt.version));
  };

  const openChat = (userId: string) =>
    void act.run(async () => {
      const conversation = await chat.open(userId);
      router.push({ pathname: '/chat/[id]', params: { id: conversation.id } });
    });

  // Before everyone is ready there is no board yet: show who we are waiting for and the Ready
  // button. (Returning nothing here left a blank screen with no way to start.)
  if (!ludo) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Title>{match.kind === 'BOT' ? 'Practice match' : 'Ludo'}</Title>
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.headline, { color: TONE_COLOR[status.tone] }]}>
            {status.headline}
          </Text>
          {status.detail ? <Body muted>{status.detail}</Body> : null}
        </View>
        <ErrorText error={act.error} />
        {canPressReady(match) ? (
          <Button
            label="Ready"
            busy={act.busy}
            onPress={() => void act.run(async () => apply(await games.ready(match.id)))}
          />
        ) : null}
        {match.status === 'EXPIRED' ||
        match.status === 'CANCELLED' ||
        match.status === 'ABANDONED' ? (
          <Button
            label="Back to games"
            tone="secondary"
            onPress={() => router.replace('/(tabs)/play')}
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
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Title>{match.kind === 'BOT' ? 'Practice match' : 'Ludo'}</Title>

      <View style={styles.legend} accessibilityLabel="Players">
        {seats.map((seat) => (
          <View
            key={seat.seat}
            style={[styles.chip, seat.state === 'turn' && { borderColor: c.success }]}
            accessibilityLabel={`${seat.name}, ${seat.colourName}, ${String(seat.home)} of 4 home${
              seat.state === 'turn' ? ', their turn' : ''
            }${seat.state === 'out' ? ', out of the game' : ''}${seat.connected ? '' : ', disconnected'}`}
          >
            <View style={[styles.dot, { backgroundColor: ludoColors.players[seat.colour] }]} />
            <View style={styles.flex}>
              <Text
                style={[styles.chipName, seat.state === 'out' && styles.struck]}
                numberOfLines={1}
              >
                {seat.name}
              </Text>
              <Text style={styles.chipMeta}>
                {seat.state === 'out'
                  ? 'out'
                  : seat.state === 'finished' && seat.place !== null
                    ? `finished ${String(seat.place)}`
                    : !seat.connected
                      ? 'offline'
                      : `${String(seat.home)}/4 home`}
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
        <LudoBoard
          ludo={ludo}
          width={boardWidth}
          movable={movable}
          mySeat={match.mySeat}
          reduced={reduced}
          onTokenPress={onToken}
        />
      </View>

      <View style={styles.diceRow}>
        <Dice
          value={shownDie(match)}
          canRoll={canRoll}
          busy={act.busy}
          reduced={reduced}
          onRoll={onRoll}
        />
        <View accessibilityLiveRegion="polite" style={styles.ticker}>
          {ticker.map((text, index) => (
            <Text key={`${String(match.version)}-${String(index)}`} style={styles.tickerText}>
              {text}
            </Text>
          ))}
        </View>
      </View>
      <ErrorText error={act.error} />

      {canPressReady(match) ? (
        <Button
          label="Ready"
          busy={act.busy}
          onPress={() => void act.run(async () => apply(await games.ready(match.id)))}
        />
      ) : null}

      {match.status === 'COMPLETED' ? (
        <View style={styles.result} accessibilityLabel="Final order">
          {placingRows(match).map((row) => (
            <Text key={row.seat} style={[styles.place, row.isMe && styles.me]}>
              {row.place}. {row.name}
              {row.left ? ' (left the game)' : ''}
            </Text>
          ))}
          {lines?.rating ? <Body>{lines.rating}</Body> : null}
          {lines?.xp ? <Body>{lines.xp}</Body> : null}
          {coinLine ? <Body>{coinLine}</Body> : null}
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
            <Body muted>Rematch requested. Waiting for the others…</Body>
          ) : null}
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
              if (!iAmOut(match)) router.replace('/(tabs)/play');
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
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: s.sm, marginBottom: s.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s.sm,
    minWidth: '47%',
    flexGrow: 1,
    padding: s.sm,
    borderRadius: theme.radii.sm,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: ludoColors.tokenInk },
  chipName: { color: c.textPrimary, fontSize: 15, fontWeight: '600' },
  chipMeta: { color: c.textSecondary, fontSize: 13 },
  struck: { textDecorationLine: 'line-through', color: c.textMuted },
  headline: { fontSize: 20, fontWeight: '700', marginBottom: s.xs },
  boardWrap: { alignItems: 'center', marginVertical: s.md },
  diceRow: { flexDirection: 'row', alignItems: 'center', gap: s.lg, marginBottom: s.md },
  ticker: { flex: 1, minHeight: 56, justifyContent: 'center' },
  tickerText: { color: c.textSecondary, fontSize: 14, marginVertical: 1 },
  result: { marginBottom: s.md },
  place: { color: c.textPrimary, fontSize: 18, marginVertical: 2 },
  me: { fontWeight: '800', color: c.success },
});
