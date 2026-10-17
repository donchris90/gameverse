import { useState } from 'react';
import type { AdminUserSummary } from '@gameverse/shared-types';
import { api } from '../api.js';
import { Badge, Button, ErrorNote, statusTone, styles } from '../ui.js';
import { UserPanel } from './UserPanel.js';

export function Users() {
  const [text, setText] = useState('');
  const [results, setResults] = useState<AdminUserSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <h2>Users</h2>
      <form
        style={styles.row}
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim().length < 2) return;
          setBusy(true);
          setSelected(null);
          api
            .searchUsers(text.trim())
            .then((found) => {
              setResults(found);
              setError(null);
            })
            .catch((err: unknown) => setError(err))
            .finally(() => setBusy(false));
        }}
      >
        <input
          aria-label="Search by username, email or id"
          placeholder="Username or email (min 2 characters)"
          value={text}
          onChange={(event) => setText(event.target.value)}
          style={{ ...styles.input, minWidth: 280 }}
        />
        <Button type="submit" disabled={busy || text.trim().length < 2}>
          Search
        </Button>
      </form>
      <p style={styles.muted}>Searching by email is recorded in the audit log.</p>
      <ErrorNote error={error} />
      {results?.length === 0 && <p style={styles.muted}>No matching users.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {results?.map((user) => (
          <li key={user.id} style={styles.card}>
            <div style={styles.row}>
              <strong>{user.username ?? '(no username)'}</strong>
              <span style={styles.muted}>{user.email}</span>
              <Badge tone={statusTone(user.status)}>{user.status}</Badge>
              <Badge tone="warn">{user.role}</Badge>
              <Button tone="neutral" onClick={() => setSelected(user.id)}>
                Open
              </Button>
            </div>
            {selected === user.id && <UserPanel userId={user.id} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
