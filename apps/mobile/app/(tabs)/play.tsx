import { theme } from '@gameverse/design-system';
import type { GameId } from '@gameverse/shared-types';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { games } from '../../src/api-client';
import { GAME_INFO, GameArt } from '../../src/GameArt';
import { usePlay } from '../../src/play-state';
import { Body, Button, ErrorText, Loading, TextField } from '../../src/ui';

const c = theme.colors;
const s = theme.spacing;

/** Order the games appear in. A game shows only when the server lists it as playable. */
const SHELF: GameId[] = ['tictactoe', 'ludo', 'draughts', 'ayo'];

export default function PlayHome() {
  const play = usePlay();
  const { router, act, progress, resume, invites, search, listedGames } = play;
  const [code, setCode] = useState('');

  if (play.current.loading && !play.current.data) return <Loading />;

  const shelf = SHELF;
  const stats = new Map(progress.data?.games.map((g) => [g.gameId as string, g]) ?? []);
  const level = progress.data;
  const fill = level ? Math.min(1, level.xp / Math.max(1, level.nextLevelXp)) : 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={play.reloadAll} tintColor={c.primary} />
      }
    >
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          Choose a game
        </Text>
        {level ? (
          <View
            accessible
            accessibilityLabel={`Level ${level.level}, ${level.xp} of ${level.nextLevelXp} experience points`}
            style={styles.levelRow}
          >
            <View style={styles.levelPill}>
              <Text style={styles.levelPillText}>Level {level.level}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${Math.round(fill * 100)}%` }]} />
            </View>
            <Text style={styles.xp}>
              {level.xp}/{level.nextLevelXp} XP
            </Text>
          </View>
        ) : null}
      </View>

      <ErrorText error={act.error} />

      {resume ? (
        <View style={[styles.banner, { borderColor: c.success }]}>
          <View style={styles.flex}>
            <Text style={styles.bannerTitle}>Match in progress</Text>
            <Body muted>Pick up where you left off.</Body>
          </View>
          <View style={styles.bannerButton}>
            <Button label="Resume" onPress={() => play.openMatch(resume)} />
          </View>
        </View>
      ) : null}

      {search ? (
        <View style={styles.banner}>
          <View style={styles.flex}>
            <Text style={styles.bannerTitle}>Looking for a player…</Text>
            <Body muted>{GAME_INFO[search.gameId as GameId]?.name ?? 'Game'}</Body>
          </View>
          <View style={styles.bannerButton}>
            <Button
              label="Cancel"
              tone="secondary"
              busy={act.busy}
              onPress={() => void play.run(() => games.cancelQueue())}
            />
          </View>
        </View>
      ) : null}

      {invites.map((invite) => (
        <View key={invite.id} style={styles.banner}>
          <View style={styles.flex}>
            <Text style={styles.bannerTitle}>Game invite</Text>
            <Body muted>{invite.host.username} invited you to play.</Body>
          </View>
          <View style={styles.bannerButton}>
            <Button
              label="Accept"
              busy={act.busy}
              onPress={() => void play.start(() => games.acceptInvite(invite.id))}
            />
            <Button
              label="Decline"
              tone="secondary"
              busy={act.busy}
              onPress={() => void play.run(() => games.declineInvite(invite.id))}
            />
          </View>
        </View>
      ))}

      {shelf.map((id) => {
        const info = GAME_INFO[id];
        const record = stats.get(id);
        // A game the server has not switched on is shown as "Coming soon", never as playable.
        const soon = !(listedGames.has(id) || id === 'tictactoe');
        return (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={
              soon
                ? `${info.name}. Coming soon.`
                : `${info.name}. ${info.tagline} ${info.tags.join(', ')}.`
            }
            accessibilityState={{ disabled: soon }}
            disabled={soon}
            onPress={() => router.push({ pathname: '/game/[id]', params: { id } })}
            style={({ pressed }) => [
              styles.gameCard,
              soon && styles.gameCardSoon,
              pressed && styles.gameCardPressed,
            ]}
          >
            <View style={[styles.banner2, { backgroundColor: info.banner }]}>
              <GameArt gameId={id} size={104} />
            </View>
            <View style={styles.gameBody}>
              <View style={styles.gameTitleRow}>
                <Text style={styles.gameName}>{info.name}</Text>
                {soon ? (
                  <View style={styles.soonBadge}>
                    <Text style={styles.soonText}>Coming soon</Text>
                  </View>
                ) : (
                  <Text style={styles.chevron}>›</Text>
                )}
              </View>
              <Body muted>{info.tagline}</Body>
              <View style={styles.tags}>
                {info.tags.map((tag) => (
                  <View key={tag} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
                {record ? (
                  <View style={[styles.tag, styles.tagStat]}>
                    <Text style={styles.tagText}>
                      {record.rating} · {record.wins}W {record.losses}L {record.draws}D
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      })}

      <View style={styles.codeCard}>
        <Text accessibilityRole="header" style={styles.codeHeading}>
          Have a room code?
        </Text>
        <Body muted>Friends can share a 6-character code to play together.</Body>
        <TextField
          label="Room code"
          value={code}
          onChangeText={(text) => setCode(text.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          placeholder="ABC234"
        />
        <Button
          label="Join room"
          busy={act.busy}
          disabled={code.trim().length !== 6 || !!resume || !!play.joined}
          onPress={() =>
            void act.run(async () => {
              // A full table starts at once; otherwise the player now sits in the room.
              const joinedRoom = await games.joinRoomResult(code);
              setCode('');
              if (joinedRoom.match) play.openMatch(joinedRoom.match);
              play.reloadAll();
            })
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  content: { padding: s.lg, paddingBottom: s.xxxl },
  flex: { flex: 1 },
  header: { marginBottom: s.lg },
  title: { color: c.textPrimary, fontSize: 28, fontWeight: '800', marginBottom: s.md },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
  levelPill: {
    backgroundColor: c.primary,
    borderRadius: theme.radii.pill,
    paddingHorizontal: s.md,
    paddingVertical: s.xs,
  },
  levelPillText: { color: c.textOnAccent, fontWeight: '700', fontSize: 13 },
  track: {
    flex: 1,
    height: 8,
    borderRadius: theme.radii.pill,
    backgroundColor: c.surfaceRaised,
    overflow: 'hidden',
  },
  trackFill: { height: 8, backgroundColor: c.success, borderRadius: theme.radii.pill },
  xp: { color: c.textSecondary, fontSize: 12 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s.md,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: theme.radii.lg,
    padding: s.lg,
    marginBottom: s.md,
  },
  bannerTitle: { color: c.textPrimary, fontSize: 16, fontWeight: '700' },
  bannerButton: { minWidth: 110, gap: s.sm },
  gameCard: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: theme.radii.xl,
    overflow: 'hidden',
    marginBottom: s.lg,
  },
  gameCardSoon: { opacity: 0.6 },
  soonBadge: {
    backgroundColor: c.surfaceRaised,
    borderRadius: theme.radii.pill,
    paddingHorizontal: s.md,
    paddingVertical: s.xs,
  },
  soonText: { color: c.textSecondary, fontSize: 12, fontWeight: '700' },
  gameCardPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  banner2: { height: 150, alignItems: 'center', justifyContent: 'center' },
  gameBody: { padding: s.lg, gap: s.sm },
  gameTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gameName: { color: c.textPrimary, fontSize: 22, fontWeight: '800' },
  chevron: { color: c.textSecondary, fontSize: 30, lineHeight: 30 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: s.sm, marginTop: s.xs },
  tag: {
    backgroundColor: c.surfaceRaised,
    borderRadius: theme.radii.pill,
    paddingHorizontal: s.md,
    paddingVertical: s.xs,
  },
  tagStat: { backgroundColor: c.background, borderColor: c.border, borderWidth: 1 },
  tagText: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
  codeCard: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: theme.radii.lg,
    padding: s.lg,
    gap: s.sm,
  },
  codeHeading: { color: c.textPrimary, fontSize: 18, fontWeight: '700' },
});
