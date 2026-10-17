import { theme } from '@gameverse/design-system';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Refine is installed; its data provider and resources (users, reports, audit log) are wired in
// Phase 1 when the API endpoints exist. Until then this shell exposes no admin actions.
createRoot(root).render(
  <StrictMode>
    <main
      style={{
        minHeight: '100vh',
        background: theme.colors.background,
        color: theme.colors.textPrimary,
        fontFamily: 'system-ui, sans-serif',
        padding: theme.spacing.xl,
      }}
    >
      <h1>GameVerse Admin</h1>
      <p style={{ color: theme.colors.textSecondary }}>No admin tools are available yet.</p>
    </main>
  </StrictMode>,
);
