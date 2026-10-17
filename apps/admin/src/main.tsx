import { theme } from '@gameverse/design-system';
import { StrictMode, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, getSession, restore, signIn, signOut, subscribe } from './api.js';
import { Button, ErrorNote, styles } from './ui.js';
import { Audit } from './views/Audit.js';
import { Reports } from './views/Reports.js';
import { Users } from './views/Users.js';

type Tab = 'reports' | 'users' | 'audit';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      style={{ ...styles.card, maxWidth: 360 }}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        signIn(email.trim(), password)
          .catch((err: unknown) => setError(err instanceof ApiError ? err : new Error('failed')))
          .finally(() => setBusy(false));
      }}
    >
      <h2>Staff sign in</h2>
      <label>
        Email
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={{ ...styles.input, display: 'block', width: '100%', boxSizing: 'border-box' }}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={{ ...styles.input, display: 'block', width: '100%', boxSizing: 'border-box' }}
        />
      </label>
      <ErrorNote error={error} />
      <Button type="submit" disabled={busy || email === '' || password === ''}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

function App() {
  const session = useSyncExternalStore(subscribe, getSession);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('reports');

  useEffect(() => {
    void restore().finally(() => setReady(true));
  }, []);

  if (!ready) return <p style={styles.muted}>Loading…</p>;
  if (!session) return <Login />;

  const isAdmin = session.user.role === 'ADMIN';
  return (
    <>
      <header style={{ ...styles.row, justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>GameVerse Admin</h1>
        <div style={styles.row}>
          <span style={styles.muted}>
            {session.user.email} ({session.user.role})
          </span>
          <Button tone="neutral" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <nav style={{ ...styles.row, margin: '16px 0' }} aria-label="Sections">
        <Button tone={tab === 'reports' ? 'primary' : 'neutral'} onClick={() => setTab('reports')}>
          Reports
        </Button>
        <Button tone={tab === 'users' ? 'primary' : 'neutral'} onClick={() => setTab('users')}>
          Users
        </Button>
        {isAdmin && (
          <Button tone={tab === 'audit' ? 'primary' : 'neutral'} onClick={() => setTab('audit')}>
            Audit log
          </Button>
        )}
      </nav>
      {tab === 'reports' && <Reports />}
      {tab === 'users' && <Users />}
      {tab === 'audit' && isAdmin && <Audit />}
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <main
      style={{
        minHeight: '100vh',
        background: theme.colors.background,
        color: theme.colors.textPrimary,
        fontFamily: 'system-ui, sans-serif',
        padding: theme.spacing.xl,
        boxSizing: 'border-box',
      }}
    >
      <App />
    </main>
  </StrictMode>,
);
