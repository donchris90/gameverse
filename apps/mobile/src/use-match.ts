import type { MatchView } from '@gameverse/shared-types';
import { clockOffset, secondsLeft, shouldApply } from '@gameverse/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { games } from './api-client';
import { realtime } from './realtime';

/**
 * Keeps one match screen in step with the server. The server is the only source of truth: this
 * hook fetches the match, applies pushed `match.update` events (dropping stale ones), refetches
 * after a reconnect or when the app returns to the foreground, and ticks a countdown against the
 * server clock.
 */
export function useMatch(matchId: string) {
  const [match, setMatch] = useState<MatchView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);
  const current = useRef<MatchView | null>(null);

  const apply = useCallback((incoming: MatchView) => {
    if (!shouldApply(current.current, incoming)) return;
    offset.current = clockOffset(incoming.serverTime, Date.now());
    current.current = incoming;
    setMatch(incoming);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await games.match(matchId));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [apply, matchId]);

  useEffect(() => {
    current.current = null;
    setMatch(null);
    void refresh();
    const unsubscribe = realtime.subscribe((event) => {
      if (event.type === 'match.update' && event.match.id === matchId) apply(event.match);
    });
    const unsubscribeConnection = realtime.onConnectionChange((connected) => {
      if (connected) void refresh();
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      unsubscribe();
      unsubscribeConnection();
      appState.remove();
    };
  }, [apply, matchId, refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const deadlineSeconds =
    match?.deadline && ['ACTIVE', 'READY', 'WAITING'].includes(match.status)
      ? secondsLeft(match.deadline.at, offset.current, now)
      : null;

  return { match, error, apply, refresh, deadlineSeconds };
}
