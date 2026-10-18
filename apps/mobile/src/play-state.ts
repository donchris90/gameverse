import type { BotLevelName, MatchView, MatchmakingStatus, RoomView } from '@gameverse/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { games } from './api-client';
import { realtime } from './realtime';
import { useAction, useLoad } from './ui';

/**
 * Everything the games home and each game's screen share: the open match, the matchmaking search,
 * the lobby (rooms and invites) and the player's progress. Loading it in one place keeps both
 * screens showing the same truth.
 */
export function usePlay() {
  const router = useRouter();
  const act = useAction();
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

  // A found match or a changed room arrives by push; refetch what the screens show.
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

  const search: NonNullable<MatchmakingStatus['searching']> | null =
    queue.data?.state === 'searching' ? queue.data.searching : null;
  const matchedFromQueue = queue.data?.state === 'matched' ? queue.data.match : null;

  // Poll while searching so the bot offer and the match appear without a push.
  useEffect(() => {
    if (!search) return;
    const timer = setInterval(() => {
      setTick((n) => n + 1);
      void reloadQueue();
    }, 2000);
    return () => clearInterval(timer);
  }, [search, reloadQueue]);

  const resume = current.data?.match ?? matchedFromQueue;
  const hosted: RoomView | null = lobby.data?.hosted ?? null;
  const joined: RoomView | null = lobby.data?.joined ?? null;
  const invites = lobby.data?.invites ?? [];
  /** True while another match, search or room already occupies the player. */
  const occupied = !!resume || !!search || !!hosted || !!joined;
  /** Games the server lists as playable (it hides games that are switched off). */
  const listedGames = new Set<string>(progress.data?.games.map((g) => g.gameId) ?? []);

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

  return {
    router,
    act,
    level,
    setLevel,
    current,
    progress,
    lobby,
    reloadAll,
    openMatch,
    search,
    resume,
    hosted,
    joined,
    invites,
    occupied,
    listedGames,
    run,
    start,
  };
}
