import { useCallback, useState } from 'react';
import { api } from '../api.js';
import { Badge, Button, ErrorNote, styles, useLoad } from '../ui.js';
import { ReasonForm } from './ReasonForm.js';

/** Admins switch games on and off here. Players see only the games that are on. */
export function Games() {
  const load = useCallback(() => api.games(), []);
  const { data, error, loading, reload } = useLoad(load);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div>
      <h2>Games</h2>
      <p style={styles.muted}>
        A game that is off is hidden from players and cannot start new matches or rooms. Matches
        already in progress finish normally. Every change is recorded in the audit log with your
        reason.
      </p>
      <ErrorNote error={error} />
      {loading && !data && <p style={styles.muted}>Loading…</p>}
      {data?.map((game) => (
        <section key={game.id} style={{ ...styles.card, marginBottom: 12 }}>
          <div style={{ ...styles.row, justifyContent: 'space-between' }}>
            <div>
              <strong>{game.name}</strong>{' '}
              <span style={styles.muted}>
                ({game.id},{' '}
                {game.minPlayers === game.maxPlayers
                  ? `${String(game.minPlayers)} players`
                  : `${String(game.minPlayers)} to ${String(game.maxPlayers)} players`}
                )
              </span>
            </div>
            <div style={styles.row}>
              <Badge tone={game.enabled ? 'ok' : 'warn'}>{game.enabled ? 'On' : 'Off'}</Badge>
              {editing !== game.id && (
                <Button
                  tone={game.enabled ? 'danger' : 'primary'}
                  onClick={() => setEditing(game.id)}
                >
                  {game.enabled ? 'Turn off' : 'Turn on'}
                </Button>
              )}
            </div>
          </div>
          {editing === game.id && (
            <ReasonForm
              label={game.enabled ? `Turn off ${game.name}` : `Turn on ${game.name}`}
              tone={game.enabled ? 'danger' : 'primary'}
              onSubmit={async (reason) => {
                await api.setGameEnabled(game.id, !game.enabled, reason);
                setEditing(null);
                reload();
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </section>
      ))}
    </div>
  );
}
