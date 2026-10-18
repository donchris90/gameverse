import { theme } from '@gameverse/design-system';
import {
  BOT_LEVELS,
  QUEUE_BOT_OFFER_AFTER_MS,
  type BotLevelName,
  type GameId,
  type MatchView,
  type RoomView,
} from '@gameverse/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { games } from '../../src/api-client';
import { realtime } from '../../src/realtime';
import { LudoCard } from '../../src/ludo/LudoCard';
import { Body, Button, ErrorText, Loading, TextField, useAction, useLoad } from '../../src/ui';

const c = theme.colors;
const s = theme.spacing;

// Only games that are playable end to end are listed.
const LIBRARY: { id: GameId; name: string; blurb: string }[] = [
  { id: 'tictactoe', name: 'Tic-tac-toe', blurb: 'Best of 3. Two players, 20 seconds a turn.' },
];

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Heading({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}

export default function PlayTab() {
  const router = useRouter();
  const act = useAction();
  const [code, setCode] = useState('');
  const [level, setLevel] = useState<BotLevelName>('medium');
  const [, setTick] = useState(0);

  const current = useLoad(useCallback(() => games.currentMatch(), []));
  const queue = useLoad(useCallback(() => games.queue(), []));
  const lobby = useLoad(useCallback(() => games.lobby(), []));
  const progress = useLoad(useCallback(() => games.progress(), []));

  const { reload: reloadCurrent } = current;
  const { reload: reloadQueue } = queue;
  const { reload: reloadLobby } = lobby;
  const { reload: reloadProgress } = progress;
  const reloadAll = useCallback(() => {
    void reloadCurrent();
    void reloadQueue();
    void reloadLobby();
    void reloadProgress();
  }, [reloadCurrent, reloadQueue, reloadLobby, reloadProgress]);

  useFocusEffect(reloadAll);

  const openMatch = useCallback(
    (match: MatchView) => router.push({ pathname: '/match/[id]', params: { id: match.id } }),
    [router],
  );

  // A found match or a changed room arrives by push; refetch what the screen shows.
  useEffect(() => {
    const off = realtime.subscribe((event) => {
      if (event.type === 'match.update' && event.match.status !== 'COMPLETED') {
        void reloadQueue();
        void reloadCurrent();
      }
      if (event.type === 'room.update') void reloadLobby();
    });
    const offConnection = realtime.onConnectionChange((connected) => {
      if (connected) reloadAll();
    });
    return () => {
      off();
      offConnection();
    };
  }, [reloadAll, reloadCurrent, reloadLobby, reloadQueue]);

  const anySearch = queue.data?.state === 'searching' ? queue.data.searching : null;
  const searching = anySearch?.gameId === 'tictactoe' ? anySearch : null;
  const matchedFromQueue = queue.data?.state === 'matched' ? queue.data.match : null;

  // Poll while searching so the bot offer and the match appear without a push.
  useEffect(() => {
    if (!anySearch) return;
    const timer = setInterval(() => {
      setTick((n) => n + 1);
      void reloadQueue();
    }, 2000);
    return () => clearInterval(timer);
  }, [anySearch, reloadQueue]);

  const resume = current.data?.match ?? matchedFromQueue;
  const anyHosted: RoomView | null = lobby.data?.hosted ?? null;
  const anyJoined: RoomView | null = lobby.data?.joined ?? null;
  // Each game's card shows only its own rooms.
  const hosted: RoomView | null = anyHosted?.gameId === 'tictactoe' ? anyHosted : null;
  const ludoHosted: RoomView | null = anyHosted?.gameId === 'ludo' ? anyHosted : null;
  const ludoJoined: RoomView | null = anyJoined?.gameId === 'ludo' ? anyJoined : null;
  // Ludo is listed only when the server says it is playable (it hides games that are switched off).
  const ludoListed = progress.data?.games.some((g) => g.gameId === 'ludo') ?? false;
  const invites = lobby.data?.invites ?? [];

  const run = (work: () => Promise<unknown>) =>
    act.run(async () => {
      await work();
      reloadAll();
    });
  const start = (work: () => Promise<MatchView>) =>
    act.run(async () => {
      openMatch(await work());
      reloadAll();
    });

  if (current.loading && !current.data) return <Loading />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={reloadAll} tintColor={c.primary} />
      }
    >
      {progress.data ? (
        <Card>
          <Text style={styles.big}>Level {progress.data.level}</Text>
          <Body muted>
            {progress.data.xp} XP · next level at {progress.data.nextLevelXp} XP
          </Body>
          {progress.data.games.map((g) => (
            <Body key={g.gameId}>
              {g.gameId === 'ludo' ? 'Ludo' : 'Tic-tac-toe'}: rating {g.rating} · {g.wins}W{' '}
              {g.losses}L {g.draws}D
            </Body>
          ))}
        </Card>
      ) : null}

      <ErrorText error={act.error} />

      {resume ? (
        <Card>
          <Heading>Match in progress</Heading>
          <Body muted>You have an open match.</Body>
          <Button label="Resume match" onPress={() => openMatch(resume)} />
        </Card>
      ) : null}

      {invites.map((invite) => (
        <Card key={invite.id}>
          <Heading>Game invite</Heading>
          <Body>{invite.host.username} invited you to play.</Body>
          <Button
            label="Accept"
            busy={act.busy}
            onPress={() => void start(() => games.acceptInvite(invite.id))}
          />
          <Button
            label="Decline"
            tone="secondary"
            busy={act.busy}
            onPress={() => void run(() => games.declineInvite(invite.id))}
          />
        </Card>
      ))}

      {LIBRARY.map((game) => (
        <Card key={game.id}>
          <Heading>{game.name}</Heading>
          <Body muted>{game.blurb}</Body>

          {searching ? (
            <>
              <Body>Looking for an opponent…</Body>
              {searching.waitedMs >= QUEUE_BOT_OFFER_AFTER_MS || searching.botOffer ? (
                <Body muted>Taking a while. You can play a computer player instead.</Body>
              ) : null}
              {searching.botOffer ? (
                <Button
                  label="Play a bot instead"
                  busy={act.busy}
                  onPress={() =>
                    void start(async () => {
                      await games.cancelQueue();
                      return games.startBot(game.id, 'medium');
                    })
                  }
                />
              ) : null}
              <Button
                label="Cancel search"
                tone="secondary"
                busy={act.busy}
                onPress={() => void run(() => games.cancelQueue())}
              />
            </>
          ) : (
            <Button
              label="Find a player"
              busy={act.busy}
              disabled={!!resume || !!anyHosted || !!anyJoined || !!anySearch}
              onPress={() => void run(() => games.joinQueue(game.id))}
            />
          )}

          <Body muted>Practice against a bot</Body>
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
            label={`Play ${level} bot`}
            tone="secondary"
            busy={act.busy}
            disabled={!!resume || !!anySearch || !!anyHosted || !!anyJoined}
            onPress={() => void start(() => games.startBot(game.id, level))}
          />

          <Button
            label="Leaderboard"
            tone="secondary"
            onPress={() => router.push({ pathname: '/leaderboard', params: { gameId: game.id } })}
          />
        </Card>
      ))}

      {ludoListed ? (
        <LudoCard
          busy={act.busy}
          blocked={!!resume || !!anySearch || !!anyHosted || !!anyJoined}
          searching={anySearch}
          hosted={ludoHosted}
          joined={ludoJoined}
          level={level}
          setLevel={setLevel}
          run={run}
          start={start}
        />
      ) : null}

      <Card>
        <Heading>Play with a friend</Heading>
        {hosted && hosted.status === 'OPEN' ? (
          <>
            <Body>
              {hosted.invited ? `Waiting for ${hosted.invited.username}` : 'Share this code:'}
            </Body>
            {hosted.code ? <Text style={styles.code}>{hosted.code}</Text> : null}
            <Button
              label="Close room"
              tone="secondary"
              busy={act.busy}
              onPress={() => void run(() => games.closeRoom(hosted.id))}
            />
          </>
        ) : hosted && hosted.matchId ? (
          <Button
            label="Open friend match"
            onPress={() =>
              router.push({ pathname: '/match/[id]', params: { id: hosted.matchId ?? '' } })
            }
          />
        ) : (
          <Button
            label="Create a private room"
            busy={act.busy}
            disabled={!!resume || !!anySearch || !!anyHosted || !!anyJoined}
            onPress={() => void run(() => games.createRoom('tictactoe'))}
          />
        )}
        <TextField
          label="Have a code?"
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
          disabled={code.trim().length !== 6 || !!resume || !!anyJoined}
          onPress={() =>
            void act.run(async () => {
              // A full table starts at once; otherwise the player now sits in the room.
              const joinedRoom = await games.joinRoomResult(code);
              setCode('');
              if (joinedRoom.match) openMatch(joinedRoom.match);
              reloadAll();
            })
          }
        />
        <Body muted>To invite a friend directly, open their profile from the Friends tab.</Body>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  content: { padding: s.lg, paddingBottom: s.xxl },
  card: {
    backgroundColor: c.surface,
    borderRadius: theme.radii.md,
    borderColor: c.border,
    borderWidth: 1,
    padding: s.lg,
    marginBottom: s.lg,
  },
  heading: { color: c.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: s.xs },
  big: { color: c.textPrimary, fontSize: 24, fontWeight: '700' },
  code: {
    color: c.textPrimary,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
    marginVertical: s.md,
  },
  row: { flexDirection: 'row', gap: s.sm },
  flex: { flex: 1 },
});
