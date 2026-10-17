import { useState } from 'react';
import type { AuditLogView } from '@gameverse/shared-types';
import { api } from '../api.js';
import { Button, ErrorNote, formatTime, styles, useLoad } from '../ui.js';
import { useCallback } from 'react';

export function Audit() {
  const load = useCallback(() => api.audit(), []);
  const { data, error, loading } = useLoad(load);
  const [extra, setExtra] = useState<AuditLogView[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [moreError, setMoreError] = useState<unknown>(null);
  const next = cursor === undefined ? (data?.nextCursor ?? null) : cursor;
  const rows = [...(data?.items ?? []), ...extra];

  return (
    <div>
      <h2>Audit log</h2>
      <p style={styles.muted}>Append-only. Admins only.</p>
      <ErrorNote error={error ?? moreError} />
      {loading && !data && <p style={styles.muted}>Loading…</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderTop: '1px solid #33377A', verticalAlign: 'top' }}>
                <td>{formatTime(row.createdAt)}</td>
                <td>{row.action}</td>
                <td>{row.actorId ?? 'system'}</td>
                <td>
                  {row.targetType}
                  {row.targetId ? ` ${row.targetId}` : ''}
                </td>
                <td>
                  <code>{row.metadata ? JSON.stringify(row.metadata) : ''}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next && (
        <Button
          tone="neutral"
          onClick={() => {
            api
              .audit(next)
              .then((page) => {
                setExtra((previous) => [...previous, ...page.items]);
                setCursor(page.nextCursor);
                setMoreError(null);
              })
              .catch((err: unknown) => setMoreError(err));
          }}
        >
          Load more
        </Button>
      )}
    </div>
  );
}
