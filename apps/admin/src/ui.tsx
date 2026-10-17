import { theme } from '@gameverse/design-system';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api.js';

const c = theme.colors;

export const styles = {
  card: {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  } satisfies CSSProperties,
  input: {
    background: c.background,
    color: c.textPrimary,
    border: `1px solid ${c.borderStrong}`,
    borderRadius: theme.radii.sm,
    padding: `${String(theme.spacing.sm)}px ${String(theme.spacing.md)}px`,
    font: 'inherit',
  } satisfies CSSProperties,
  muted: { color: c.textSecondary } satisfies CSSProperties,
  row: {
    display: 'flex',
    gap: theme.spacing.sm,
    alignItems: 'center',
    flexWrap: 'wrap',
  } satisfies CSSProperties,
};

type Tone = 'primary' | 'danger' | 'neutral';

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  tone?: Tone;
  disabled?: boolean;
}) {
  const tone = props.tone ?? 'primary';
  const background =
    tone === 'primary' ? c.primary : tone === 'danger' ? c.accentCoral : c.surfaceRaised;
  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        background,
        color: c.textOnAccent,
        border: `1px solid ${tone === 'neutral' ? c.borderStrong : background}`,
        borderRadius: theme.radii.sm,
        padding: `${String(theme.spacing.sm)}px ${String(theme.spacing.lg)}px`,
        font: 'inherit',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.6 : 1,
      }}
    >
      {props.children}
    </button>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
  return (
    <p role="alert" style={{ color: c.danger, margin: `${String(theme.spacing.sm)}px 0` }}>
      {message}
    </p>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'ok' | 'bad' | 'warn' }) {
  const color = tone === 'bad' ? c.danger : tone === 'warn' ? c.warning : c.success;
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}`,
        borderRadius: theme.radii.sm,
        padding: '1px 8px',
        fontSize: 12,
      }}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): 'ok' | 'bad' | 'warn' {
  if (status === 'ACTIVE' || status === 'RESOLVED') return 'ok';
  if (status === 'OPEN' || status === 'SUSPENDED') return 'warn';
  return 'bad';
}

export const formatTime = (iso: string): string => new Date(iso).toLocaleString();

/** Runs `load` on mount and whenever its identity changes; exposes loading/error and a reload. */
export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);
  useEffect(() => run(), [run]);
  return { data, error, loading, reload: run };
}
