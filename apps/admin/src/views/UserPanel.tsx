import { USER_ROLES, type UserRole } from '@gameverse/shared-types';
import { useCallback, useState } from 'react';
import { api, getSession } from '../api.js';
import { Badge, Button, ErrorNote, formatTime, statusTone, styles, useLoad } from '../ui.js';
import { ReasonForm } from './ReasonForm.js';

type Mode = null | 'ban' | 'suspend' | 'reinstate' | 'role';

export function UserPanel(props: { userId: string; reportId?: string; onChanged?: () => void }) {
  const load = useCallback(() => api.user(props.userId), [props.userId]);
  const { data: user, error, loading, reload } = useLoad(load);
  const [mode, setMode] = useState<Mode>(null);
  const [role, setRole] = useState<UserRole>('USER');
  const isAdmin = getSession()?.user.role === 'ADMIN';

  if (loading && !user) return <p style={styles.muted}>Loading…</p>;
  if (!user) return <ErrorNote error={error} />;

  const done = () => {
    setMode(null);
    reload();
    props.onChanged?.();
  };

  return (
    <section style={styles.card} aria-label="User details">
      <div style={styles.row}>
        <h3 style={{ margin: 0 }}>{user.username ?? '(no username yet)'}</h3>
        <Badge tone={statusTone(user.status)}>{user.status}</Badge>
        <Badge tone="warn">{user.role}</Badge>
      </div>
      <p style={styles.muted}>
        {user.email} {user.emailVerified ? '(verified)' : '(unverified)'} · joined{' '}
        {formatTime(user.createdAt)} · id {user.id}
      </p>
      <p>
        Reports against: {user.reportsAgainst} ({user.openReportsAgainst} open) · reports made:{' '}
        {user.reportsMade} · friends: {user.friendCount}
      </p>

      {user.recentActions.length > 0 && (
        <details>
          <summary>Recent moderation actions ({user.recentActions.length})</summary>
          <ul>
            {user.recentActions.map((action) => (
              <li key={action.id}>
                {action.type} · {formatTime(action.createdAt)} · {action.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ErrorNote error={error} />
      {mode === null ? (
        <div style={styles.row}>
          {user.status === 'ACTIVE' && (
            <>
              <Button tone="neutral" onClick={() => setMode('suspend')}>
                Suspend
              </Button>
              <Button tone="danger" onClick={() => setMode('ban')}>
                Ban
              </Button>
            </>
          )}
          {(user.status === 'SUSPENDED' || user.status === 'BANNED') && (
            <Button onClick={() => setMode('reinstate')}>Reinstate</Button>
          )}
          {isAdmin && user.status !== 'DELETED' && (
            <Button tone="neutral" onClick={() => setMode('role')}>
              Change role
            </Button>
          )}
        </div>
      ) : mode === 'role' ? (
        <>
          <label>
            New role{' '}
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
              style={styles.input}
            >
              {USER_ROLES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <ReasonForm
            label={`Set role to ${role}`}
            onSubmit={async (reason) => {
              await api.changeRole(user.id, role, reason);
              done();
            }}
            onCancel={() => setMode(null)}
          />
        </>
      ) : (
        <ReasonForm
          label={
            mode === 'ban' ? 'Ban user' : mode === 'suspend' ? 'Suspend user' : 'Reinstate user'
          }
          tone={mode === 'ban' ? 'danger' : 'primary'}
          onSubmit={async (reason) => {
            await api.act(user.id, mode, reason, props.reportId);
            done();
          }}
          onCancel={() => setMode(null)}
        />
      )}
    </section>
  );
}
