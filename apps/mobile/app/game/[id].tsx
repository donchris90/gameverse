import { theme } from '@gameverse/design-system';
import {
  BOT_LEVELS,
  QUEUE_BOT_OFFER_AFTER_MS,
  formatCoins,
  type EntryFee,
  type GameId,
} from '@gameverse/shared-types';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { games } from '../../src/api-client';
import { EntryPicker } from '../../src/EntryPicker';
import { GAME_INFO, GameArt } from '../../src/GameArt';
import { LudoCard } from '../../src/ludo/LudoCard';
import { usePlay } from '../../src/play-state';
import { Body, Button, Empty, ErrorText, Loading } from '../../src/ui';

const c = theme.colors;
const s = theme.spacing;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** One game: how to start it (find a player, practise against a bot, play with friends). */
export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const play = usePlay();
  const [entryFee, setEntryFee] = useState<EntryFee>(0);
  const info = id && id in GAME_INFO ? GAME_INFO[id as GameId] : null;

  if (!info) return <Empty text="That game does not exist." />;
  if (play.progress.loading && !play.progress.data) return <Loading />;
  if (!play.listedGames.has(info.id) && info.id !== 'tictactoe') {
    return <Empty text={`${info.name} is not available right now.`} />;
  }

  const { act, router, search, resume, hosted, joined } = play;
  const record = play.progress.data?.games.find((g) => g.gameId === info.id);
  const searchingHere = search?.gameId === info.id ? search : null;
  const room = hosted?.gameId === info.id ? hosted : null;

  return (
    <>
      <Stack.Screen options={{ title: info.name }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={play.reloadAll} tintColor={c.primary} />
        }
      >
        <View style={[styles.hero, { backgroundColor: info.banner }]}>
          <GameArt gameId={info.id} size={96} />
          <View style={styles.flex}>
            <Text accessibilityRole="header" style={styles.heroName}>
              {info.name}
            </Text>
            <Text style={styles.heroTagline}>{info.tagline}</Text>
            <Text style={styles.heroMeta}>
              {info.tags.join(' · ')}
              {record ? `  ·  rating ${record.rating}` : ''}
            </Text>
          </View>
        </View>

        <ErrorText error={act.error} />

        {resume ? (
          <Section title="Match in progress">
            <Body muted>You have an open match.</Body>
            <Button label="Resume match" onPress={() => play.openMatch(resume)} />
          </Section>
        ) : null}

        {!resume && !searchingHere && !room && !joined ? (
          <Section title="Entry fee">
            <EntryPicker
              value={entryFee}
              onChange={setEntryFee}
              balance={play.coins.data?.balance ?? null}
              disabled={act.busy}
            />
          </Section>
        ) : null}

        {info.id === 'ludo' ? (
          <LudoCard
            entryFee={entryFee}
            busy={act.busy}
            blocked={play.occupied}
            searching={search}
            hosted={hosted?.gameId === 'ludo' ? hosted : null}
            joined={joined?.gameId === 'ludo' ? joined : null}
            level={play.level}
            setLevel={play.setLevel}
            run={play.run}
            start={play.start}
          />
        ) : (
          <>
            <Section title="Quick match">
              {searchingHere ? (
                <>
                  <Body>Looking for an opponent…</Body>
                  {searchingHere.entryFee > 0 ? (
                    <Body muted>
                      Entry {formatCoins(searchingHere.entryFee)} bonus coins, taken when a match is
                      found.
                    </Body>
                  ) : null}
                  {searchingHere.waitedMs >= QUEUE_BOT_OFFER_AFTER_MS || searchingHere.botOffer ? (
                    <Body muted>Taking a while. You can play a computer player instead.</Body>
                  ) : null}
                  {searchingHere.botOffer ? (
                    <Button
                      label="Play a bot instead"
                      busy={act.busy}
                      onPress={() =>
                        void play.start(async () => {
                          await games.cancelQueue();
                          return games.startBot(info.id, 'medium');
                        })
                      }
                    />
                  ) : null}
                  <Button
                    label="Cancel search"
                    tone="secondary"
                    busy={act.busy}
                    onPress={() => void play.run(() => games.cancelQueue())}
                  />
                </>
              ) : (
                <>
                  <Body muted>Get matched with another player at your level.</Body>
                  <Button
                    label="Find a player"
                    busy={act.busy}
                    disabled={play.occupied}
                    onPress={() =>
                      void play.run(() => games.joinQueue(info.id, undefined, entryFee))
                    }
                  />
                </>
              )}
            </Section>

            <Section title="Practice against a bot">
              <Body muted>Bots are always labelled. Choose how hard they play.</Body>
              <View style={styles.row}>
                {BOT_LEVELS.map((name) => (
                  <View key={name} style={styles.flex}>
                    <Button
                      label={name}
                      tone={play.level === name ? 'primary' : 'secondary'}
                      onPress={() => play.setLevel(name)}
                    />
                  </View>
                ))}
              </View>
              <Button
                label={`Play ${play.level} bot`}
                tone="secondary"
                busy={act.busy}
                disabled={play.occupied}
                onPress={() => void play.start(() => games.startBot(info.id, play.level))}
              />
            </Section>

            <Section title="Play with a friend">
              {room && room.status === 'OPEN' ? (
                <>
                  <Body>
                    {room.invited ? `Waiting for ${room.invited.username}` : 'Share this code:'}
                  </Body>
                  {room.code ? <Text style={styles.code}>{room.code}</Text> : null}
                  {room.entryFee > 0 ? (
                    <Body muted>
                      Entry {formatCoins(room.entryFee)} bonus coins each, taken when the match
                      starts.
                    </Body>
                  ) : null}
                  <Button
                    label="Close room"
                    tone="secondary"
                    busy={act.busy}
                    onPress={() => void play.run(() => games.closeRoom(room.id))}
                  />
                </>
              ) : room && room.matchId ? (
                <Button
                  label="Open friend match"
                  onPress={() =>
                    router.push({ pathname: '/match/[id]', params: { id: room.matchId ?? '' } })
                  }
                />
              ) : (
                <>
                  <Body muted>
                    Create a private room and share its code. To invite a friend directly, open
                    their profile from the Friends tab.
                  </Body>
                  <Button
                    label="Create a private room"
                    busy={act.busy}
                    disabled={play.occupied}
                    onPress={() =>
                      void play.run(() => games.createRoom(info.id, undefined, entryFee))
                    }
                  />
                </>
              )}
            </Section>
          </>
        )}

        <Button
          label="Leaderboard"
          tone="secondary"
          onPress={() => router.push({ pathname: '/leaderboard', params: { gameId: info.id } })}
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  content: { padding: s.lg, paddingBottom: s.xxxl, gap: s.lg },
  flex: { flex: 1 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s.lg,
    borderRadius: theme.radii.xl,
    padding: s.lg,
  },
  heroName: { color: c.textPrimary, fontSize: 26, fontWeight: '800' },
  heroTagline: { color: c.textSecondary, fontSize: 14, marginTop: s.xs },
  heroMeta: { color: c.textMuted, fontSize: 12, marginTop: s.sm },
  section: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: theme.radii.lg,
    padding: s.lg,
    gap: s.sm,
  },
  sectionTitle: { color: c.textPrimary, fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', gap: s.sm },
  code: {
    color: c.textPrimary,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
    marginVertical: s.md,
  },
});
