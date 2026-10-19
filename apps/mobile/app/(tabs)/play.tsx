import { gameGradients, theme } from '@gameverse/design-system';
import type { GameId } from '@gameverse/shared-types';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { coinBanner, ErrorCode, formatCoins } from '@gameverse/shared-types';
import { games, wallet } from '../../src/api-client';
import { GAME_INFO, GameArt } from '../../src/GameArt';
import { GradientCard } from '../../src/GradientCard';
import { ApiError } from '../../src/http';
import { usePlay } from '../../src/play-state';
import { Body, Button, ErrorText, Loading, TextField } from '../../src/ui';

const c = theme.colors;
const s = theme.spacing;

/** Order the games appear in. A game shows only when the server lists it as playable. */
const SHELF: GameId[] = ['tictactoe', 'ludo', 'draughts', 'ayo'];

function feeToConfirm(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.code !== ErrorCode.ENTRY_FEE_CONFIRMATION_REQUIRED) {
    return null;
  }
  const details = err.details as { entryFee?: unknown } | undefined;
  return typeof details?.entryFee === 'number' ? details.entryFee : null;
}

function confirmFee(fee: number): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Entry fee',
      `This room costs ${formatCoins(fee)} bonus coins to join. The winner takes the pot; a draw or a cancelled match returns your coins.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: `Join for ${formatCoins(fee)}`, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** The tic-tac-toe marks are red and blue, so they sit on a light tile to stay readable on a gradient. */
function ArtFrame({ gameId, size }: { gameId: GameId; size: number }) {
  if (gameId !== 'tictactoe') return <GameArt gameId={gameId} size={size} />;
  return (
    <View style={styles.artTile}>
      <GameArt gameId={gameId} size={size - 8} />
    </View>
  );
}

export default function PlayHome() {
  const play = usePlay();
  const { router, act, progress, coins, resume, invites, search, listedGames } = play;
  const { width } = useWindowDimensions();
  const [code, setCode] = useState('');

  if (play.current.loading && !play.current.data) return <Loading />;

  const stats = new Map(progress.data?.games.map((g) => [g.gameId as string, g]) ?? []);
  const level = progress.data;
  const fill = level ? Math.min(1, level.xp / Math.max(1, level.nextLevelXp)) : 0;
  const banner = coins.data ? coinBanner(coins.data) : null;
  // A game the server has not switched on is "Coming soon", never shown as playable.
  const isSoon = (id: GameId) => !(listedGames.has(id) || id === 'tictactoe');
  const featured = SHELF.filter((id) => !isSoon(id));
  const heroWidth = Math.min(width - s.lg * 2, 340);
  const open = (id: GameId) => router.push({ pathname: '/game/[id]', params: { id } });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={play.reloadAll} tintColor={c.primary} />
      }
    >
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={styles.title}>
            Game Center
          </Text>
          <Text style={styles.subtitle}>Pick a game, find a rival, climb the board</Text>
        </View>
        {banner ? (
          <View accessible accessibilityLabel={banner.accessibilityLabel} style={styles.walletChip}>
            <View style={styles.coinDot}>
              <Text style={styles.coinDotText}>C</Text>
            </View>
            <Text style={styles.walletText}>{banner.balanceText}</Text>
          </View>
        ) : null}
      </View>

      {level ? (
        <View
          accessible
          accessibilityLabel={`Level ${level.level}, ${level.xp} of ${level.nextLevelXp} experience points`}
          style={styles.levelCard}
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

      {banner?.claimLabel ? (
        <GradientCard id="coins" colors={gameGradients.coins} radius={theme.radii.lg}>
          <View style={styles.bonusRow}>
            <View style={styles.flex}>
              <Text style={styles.bonusTitle}>{banner.balanceText} bonus coins</Text>
              <Text style={styles.onGradientMuted}>{banner.note}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={banner.claimLabel}
              disabled={act.busy}
              onPress={() =>
                void act.run(async () => {
                  await wallet.claimDaily();
                  await coins.reload();
                })
              }
              style={({ pressed }) => [styles.claim, pressed && styles.pressed]}
            >
              <Text style={styles.claimText}>{banner.claimLabel}</Text>
            </Pressable>
          </View>
        </GradientCard>
      ) : banner ? (
        <Text style={styles.coinNote}>{banner.note}</Text>
      ) : null}

      <Text accessibilityRole="header" style={styles.sectionLabel}>
        Featured
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={heroWidth + s.md}
        decelerationRate="fast"
        contentContainerStyle={styles.heroRow}
      >
        {featured.map((id) => {
          const info = GAME_INFO[id];
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={`${info.name}. ${info.tagline} ${info.tags.join(', ')}.`}
              onPress={() => open(id)}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <GradientCard
                id={`hero-${id}`}
                colors={gameGradients[id]}
                radius={theme.radii.xl}
                style={[styles.hero, { width: heroWidth }]}
              >
                <View style={styles.heroArt}>
                  <ArtFrame gameId={id} size={96} />
                </View>
                <View style={styles.heroText}>
                  <Text style={styles.heroName}>{info.name}</Text>
                  <Text numberOfLines={2} style={styles.onGradientMuted}>
                    {info.tagline}
                  </Text>
                  <View style={styles.heroFoot}>
                    {info.tags.map((tag) => (
                      <View key={tag} style={styles.glassPill}>
                        <Text style={styles.glassPillText}>{tag}</Text>
                      </View>
                    ))}
                    <View style={styles.playPill}>
                      <Text style={styles.playPillText}>Play</Text>
                    </View>
                  </View>
                </View>
              </GradientCard>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text accessibilityRole="header" style={styles.sectionLabel}>
        All games
      </Text>
      <View style={styles.grid}>
        {SHELF.map((id) => {
          const info = GAME_INFO[id];
          const record = stats.get(id);
          const soon = isSoon(id);
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
              onPress={() => open(id)}
              style={({ pressed }) => [
                styles.gridCell,
                soon && styles.soon,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.gridCard}>
                <GradientCard
                  id={`tile-${id}`}
                  colors={gameGradients[id]}
                  radius={theme.radii.md}
                  style={styles.tileArt}
                >
                  <ArtFrame gameId={id} size={64} />
                </GradientCard>
                <Text style={styles.gridName}>{info.name}</Text>
                {soon ? (
                  <View style={styles.soonBadge}>
                    <Text style={styles.soonText}>Coming soon</Text>
                  </View>
                ) : record ? (
                  <Text style={styles.gridMeta}>
                    {record.rating} · {record.wins}W {record.losses}L {record.draws}D
                  </Text>
                ) : (
                  <Text style={styles.gridMeta}>{info.tags.join(' · ')}</Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

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
              let joinedRoom;
              try {
                joinedRoom = await games.joinRoomResult(code);
              } catch (err) {
                // A paid room needs a deliberate yes to its exact fee before any coins move.
                const fee = feeToConfirm(err);
                if (fee === null) throw err;
                const agreed = await confirmFee(fee);
                if (!agreed) return;
                joinedRoom = await games.joinRoomResult(code, fee);
              }
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
  content: { padding: s.lg, paddingBottom: s.xxxl, gap: s.md },
  flex: { flex: 1 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: s.md },
  title: { color: c.textPrimary, fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: c.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 2 },
  walletChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: theme.radii.pill,
    paddingHorizontal: s.md,
    paddingVertical: 6,
  },
  walletText: { color: c.textPrimary, fontWeight: '800', fontSize: 14 },
  coinDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinDotText: { color: '#0B0C24', fontWeight: '900', fontSize: 12 },
  levelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s.sm,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: theme.radii.lg,
    padding: s.md,
  },
  levelPill: {
    backgroundColor: c.primary,
    borderRadius: theme.radii.pill,
    paddingHorizontal: s.md,
    paddingVertical: s.xs,
  },
  levelPillText: { color: c.textOnAccent, fontWeight: '800', fontSize: 13 },
  track: {
    flex: 1,
    height: 8,
    borderRadius: theme.radii.pill,
    backgroundColor: c.surfaceRaised,
    overflow: 'hidden',
  },
  trackFill: { height: 8, backgroundColor: c.success, borderRadius: theme.radii.pill },
  xp: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s.md,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: theme.radii.lg,
    padding: s.lg,
  },
  bannerTitle: { color: c.textPrimary, fontSize: 16, fontWeight: '700' },
  bannerButton: { minWidth: 110, gap: s.sm },
  bonusRow: { flexDirection: 'row', alignItems: 'center', gap: s.md, padding: s.lg },
  bonusTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  onGradientMuted: { color: '#FFFFFF', opacity: 0.92, fontSize: 13, fontWeight: '600' },
  claim: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radii.pill,
    paddingHorizontal: s.lg,
    paddingVertical: s.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  claimText: { color: '#8A4B00', fontWeight: '900', fontSize: 14 },
  coinNote: { color: c.textSecondary, fontSize: 13, fontWeight: '600' },
  sectionLabel: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: s.sm,
    marginBottom: -s.xs,
  },
  heroRow: { gap: s.md, paddingVertical: 2, paddingRight: s.lg },
  hero: { minHeight: 190, padding: s.lg, flexDirection: 'row', gap: s.md, alignItems: 'center' },
  artTile: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 14, padding: 4 },
  heroArt: { alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1, gap: s.xs },
  heroName: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
  heroFoot: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: s.sm,
  },
  glassPill: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: theme.radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  glassPillText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  playPill: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radii.pill,
    paddingHorizontal: s.md,
    paddingVertical: 5,
  },
  playPillText: { color: '#0B0C24', fontSize: 13, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: s.md },
  gridCell: { width: '47.5%', flexGrow: 1 },
  gridCard: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: theme.radii.lg,
    padding: s.sm,
    gap: 4,
  },
  tileArt: { height: 92, alignItems: 'center', justifyContent: 'center' },
  gridName: { color: c.textPrimary, fontSize: 16, fontWeight: '800', marginTop: 2 },
  gridMeta: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
  soon: { opacity: 0.6 },
  soonBadge: {
    alignSelf: 'flex-start',
    backgroundColor: c.surfaceRaised,
    borderRadius: theme.radii.pill,
    paddingHorizontal: s.md,
    paddingVertical: 2,
  },
  soonText: { color: c.textSecondary, fontSize: 12, fontWeight: '700' },
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
