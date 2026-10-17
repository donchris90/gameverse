import { theme } from '@gameverse/design-system';
import { GAME_IDS, type GameId } from '@gameverse/shared-types';
import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { games } from '../src/api-client';
import { Avatar, Body, Empty, ErrorText, Loading, useLoad } from '../src/ui';

const c = theme.colors;
const s = theme.spacing;

export default function LeaderboardScreen() {
  const params = useLocalSearchParams<{ gameId?: string }>();
  const gameId: GameId = GAME_IDS.find((id) => id === params.gameId) ?? 'tictactoe';
  const board = useLoad(useCallback(() => games.leaderboard(gameId), [gameId]));

  if (board.loading && !board.data) return <Loading />;
  if (!board.data) return <ErrorText error={board.error} />;
  const { entries, me, minRatedGames } = board.data;

  return (
    <View style={styles.screen}>
      {me ? (
        <View style={styles.me}>
          <Body>
            {me.rank === null
              ? `Play ${String(minRatedGames)} rated games to appear on the board (${String(me.ratedGames)} so far).`
              : `You are #${String(me.rank)} with rating ${String(me.rating)}.`}
          </Body>
        </View>
      ) : null}
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.userId}
        ListEmptyComponent={<Empty text="Nobody is ranked yet." />}
        refreshing={board.loading}
        onRefresh={() => void board.reload()}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rank}>{item.rank}</Text>
            <Avatar avatarId={item.avatarId} name={item.username} size={36} />
            <Text style={styles.name}>{item.username}</Text>
            <Text style={styles.rating}>{item.rating}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  me: { padding: s.lg, borderBottomColor: c.border, borderBottomWidth: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s.md,
    paddingHorizontal: s.lg,
    paddingVertical: s.md,
    borderBottomColor: c.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { color: c.textSecondary, width: 32, fontSize: 16, fontWeight: '700' },
  name: { color: c.textPrimary, flex: 1, fontSize: 16 },
  rating: { color: c.textPrimary, fontSize: 16, fontWeight: '700' },
});
