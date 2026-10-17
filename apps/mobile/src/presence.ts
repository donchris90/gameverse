import { useEffect, useState } from 'react';
import { me } from './api-client';
import { realtime } from './realtime';

/**
 * Online state for a set of users: one query for the starting point, then live `presence.update`
 * events. Missing/null means "unknown or hidden", which the UI shows the same as offline.
 */
export function usePresence(userIds: string[]): Record<string, boolean> {
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const key = userIds.slice(0, 100).join(',');

  useEffect(() => {
    const ids = key === '' ? [] : key.split(',');
    if (ids.length === 0) return;
    let cancelled = false;
    me.presence(ids)
      .then((entries) => {
        if (cancelled) return;
        setOnline(
          Object.fromEntries(entries.map((entry) => [entry.userId, entry.online === true])),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(
    () =>
      realtime.subscribe((event) => {
        if (event.type === 'presence.update') {
          setOnline((current) => ({ ...current, [event.userId]: event.online }));
        }
      }),
    [],
  );

  return online;
}
