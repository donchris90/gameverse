import { theme } from '@gameverse/design-system';
import {
  BOT_LEVELS,
  LUDO_TABLE_SIZES,
  QUEUE_BOT_OFFER_AFTER_MS,
  roomSummary,
  formatCoins,
  type BotLevelName,
  type EntryFee,
  type MatchView,
  type MatchmakingStatus,
  type RoomView,
} from '@gameverse/shared-types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { games } from '../api-client';
import { Body, Button } from '../ui';

const c = theme.colors;
const s = theme.spacing;

type Search = NonNullable<MatchmakingStatus['searching']>;

/**
 * The Ludo part of the Play tab: pick a table size, find players, practise against bots, or open a
 * private table for friends. Shown only when the server lists Ludo as playable.
 */
export function LudoCard({
  entryFee,
  busy,
  blocked,
  searching,
  hosted,
  joined,
  level,
  setLevel,
  run,
  start,
}: {
  /** Bonus coins each player pays for a match against people. Bots are always free. */
  entryFee: EntryFee;
  busy: boolean;
  /** True while another match, search or room already occupies the player. */
  blocked: boolean;
  searching: Search | null;
  hosted: RoomView | null;
  joined: RoomView | null;
  level: BotLevelName;
  setLevel: (level: BotLevelName) => void;
  run: (work: () => Promise<unknown>) => Promise<unknown>;
  start: (work: () => Promise<MatchView>) => Promise<unknown>;
}) {
  const router = useRouter();
  const [size, setSize] = useState<number>(4);
  const room = hosted ?? joined;
  const searchingLudo = searching?.gameId === 'ludo' ? searching : null;
  const otherSearch = searching !== null && searching.gameId !== 'ludo';
  const summary = room ? roomSummary(room, hosted ? room.host.userId : '') : null;

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        Ludo
      </Text>
      <Body muted>
        2 to 4 players. Roll a six to leave your base, then bring all four tokens home first. 20
        seconds a turn.
      </Body>

      {!room ? (
        <>
          <Body>Players at the table</Body>
          <View style={styles.row}>
            {LUDO_TABLE_SIZES.map((n) => (
              <View key={n} style={styles.flex}>
                <Button
                  label={String(n)}
                  tone={size === n ? 'primary' : 'secondary'}
                  disabled={searchingLudo !== null}
                  onPress={() => setSize(n)}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}

      {searchingLudo ? (
        <>
          <Body>{`Looking for ${String(searchingLudo.players)} players…`}</Body>
          {searchingLudo.entryFee > 0 ? (
            <Body muted>
              {`Entry ${formatCoins(searchingLudo.entryFee)} bonus coins, taken when the table is full. First home takes the pot.`}
            </Body>
          ) : null}
          {searchingLudo.waitedMs >= QUEUE_BOT_OFFER_AFTER_MS || searchingLudo.botOffer ? (
            <Body muted>Taking a while. You can play with computer players instead.</Body>
          ) : null}
          {searchingLudo.botOffer ? (
            <Button
              label="Play with bots instead"
              busy={busy}
              onPress={() =>
                void start(async () => {
                  await games.cancelQueue();
                  return games.startBot('ludo', 'medium', searchingLudo.players);
                })
              }
            />
          ) : null}
          <Button
            label="Cancel search"
            tone="secondary"
            busy={busy}
            onPress={() => void run(() => games.cancelQueue())}
          />
        </>
      ) : !room ? (
        <>
          <Button
            label={`Find ${String(size)} players`}
            busy={busy}
            disabled={blocked || otherSearch}
            onPress={() => void run(() => games.joinQueue('ludo', size, entryFee))}
          />

          <Body muted>Practice against bots (labelled Bot)</Body>
          <View style={styles.row}>
            {BOT_LEVELS.map((name) => (
              <View key={name} style={styles.flex}>
                <Button
                  label={name}
                  tone={level === name ? 'primary' : 'secondary'}
                  onPress={() => setLevel(name)}
                />
              </View>
            ))}
          </View>
          <Button
            label={`Play ${String(size - 1)} ${level} bot${size === 2 ? '' : 's'}`}
            tone="secondary"
            busy={busy}
            disabled={blocked || otherSearch}
            onPress={() => void start(() => games.startBot('ludo', level, size))}
          />

          <Body muted>Play with friends</Body>
          <Button
            label={`Open a private table for ${String(size)}`}
            tone="secondary"
            busy={busy}
            disabled={blocked || otherSearch}
            onPress={() => void run(() => games.createRoom('ludo', size, entryFee))}
          />
        </>
      ) : null}

      {room && summary && room.status === 'OPEN' ? (
        <>
          <Body>
            {summary.isHost ? 'Your table. Share this code:' : `${room.host.username}'s table`}
          </Body>
          {room.code ? <Text style={styles.code}>{room.code}</Text> : null}
          <Text style={styles.progress} accessibilityLiveRegion="polite">
            {summary.progress}
          </Text>
          <Body muted>{summary.names.join(', ')}</Body>
          {summary.isHost ? (
            <>
              <Button
                label={`Start with ${String(summary.joined)} players`}
                busy={busy}
                disabled={!summary.canStart}
                onPress={() => void start(() => games.startRoom(room.id))}
              />
              {summary.canFillWithBots ? (
                <Button
                  label={`Fill ${String(summary.missing)} empty seat${summary.missing === 1 ? '' : 's'} with ${level} bots and start`}
                  tone="secondary"
                  busy={busy}
                  onPress={() => void start(() => games.startRoom(room.id, level))}
                />
              ) : null}
              <Button
                label="Close table"
                tone="secondary"
                busy={busy}
                onPress={() => void run(() => games.closeRoom(room.id))}
              />
            </>
          ) : (
            <Button
              label="Leave table"
              tone="secondary"
              busy={busy}
              onPress={() => void run(() => games.leaveRoom(room.id))}
            />
          )}
        </>
      ) : null}

      {room && room.status === 'STARTED' && room.matchId ? (
        <Button
          label="Open match"
          onPress={() =>
            router.push({ pathname: '/match/[id]', params: { id: room.matchId ?? '' } })
          }
        />
      ) : null}

      <Button
        label="Leaderboard"
        tone="secondary"
        onPress={() => router.push({ pathname: '/leaderboard', params: { gameId: 'ludo' } })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    borderRadius: theme.radii.md,
    borderColor: c.border,
    borderWidth: 1,
    padding: s.lg,
    marginBottom: s.lg,
  },
  heading: { color: c.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: s.xs },
  row: { flexDirection: 'row', gap: s.sm },
  flex: { flex: 1 },
  code: {
    color: c.textPrimary,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
    marginVertical: s.md,
  },
  progress: { color: c.textPrimary, fontSize: 18, fontWeight: '700', marginVertical: s.xs },
});
