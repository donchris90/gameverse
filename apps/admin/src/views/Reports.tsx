import { REPORT_STATUSES, type ReportStatus, type ReportView } from '@gameverse/shared-types';
import { useCallback, useState } from 'react';
import { api } from '../api.js';
import { Badge, Button, ErrorNote, formatTime, statusTone, styles, useLoad } from '../ui.js';
import { ReasonForm } from './ReasonForm.js';
import { UserPanel } from './UserPanel.js';

function ReportCard({ report, onChanged }: { report: ReportView; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const isOpen = report.status === 'OPEN';

  return (
    <li style={styles.card}>
      <div style={styles.row}>
        <Badge tone={statusTone(report.status)}>{report.status}</Badge>
        <strong>{report.reason}</strong>
        <span style={styles.muted}>
          {report.reporter?.username ?? 'deleted user'} reported{' '}
          {report.reported?.username ?? 'deleted user'} · {formatTime(report.createdAt)}
        </span>
        <Button tone="neutral" onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Review'}
        </Button>
      </div>
      {report.details && <p>“{report.details}”</p>}
      {open && (
        <div>
          {report.messageSnapshot !== null && (
            <div>
              <h4>Reported message (as it was when reported)</h4>
              <blockquote style={{ margin: 0 }}>{report.messageSnapshot}</blockquote>
              {report.context && report.context.length > 0 && (
                <details open>
                  <summary>Messages before it</summary>
                  <ul>
                    {report.context.map((message) => (
                      <li key={`${message.createdAt}-${message.senderId}`}>
                        <span style={styles.muted}>
                          {message.senderId === report.reportedUserId ? 'reported user' : 'other'} ·{' '}
                          {formatTime(message.createdAt)}:
                        </span>{' '}
                        {message.body}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {report.resolutionNote && <p style={styles.muted}>Resolution: {report.resolutionNote}</p>}
          <UserPanel
            userId={report.reportedUserId}
            {...(isOpen ? { reportId: report.id } : {})}
            onChanged={onChanged}
          />
          {isOpen &&
            (dismissing ? (
              <ReasonForm
                label="Dismiss report"
                tone="neutral"
                onSubmit={async (note) => {
                  await api.dismissReport(report.id, note);
                  setDismissing(false);
                  onChanged();
                }}
                onCancel={() => setDismissing(false)}
              />
            ) : (
              <Button tone="neutral" onClick={() => setDismissing(true)}>
                Dismiss without action
              </Button>
            ))}
        </div>
      )}
    </li>
  );
}

export function Reports() {
  const [status, setStatus] = useState<ReportStatus>('OPEN');
  const [extra, setExtra] = useState<ReportView[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [moreError, setMoreError] = useState<unknown>(null);
  const load = useCallback(() => {
    setExtra([]);
    setCursor(undefined);
    return api.reports(status);
  }, [status]);
  const { data, error, loading, reload } = useLoad(load);

  const next = cursor === undefined ? (data?.nextCursor ?? null) : cursor;
  const items = [...(data?.items ?? []), ...extra];

  return (
    <div>
      <h2>Reports</h2>
      <div style={styles.row} role="tablist" aria-label="Report status">
        {REPORT_STATUSES.map((value) => (
          <Button
            key={value}
            tone={value === status ? 'primary' : 'neutral'}
            onClick={() => setStatus(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <ErrorNote error={error ?? moreError} />
      {loading && !data && <p style={styles.muted}>Loading…</p>}
      {data && items.length === 0 && <p style={styles.muted}>No {status.toLowerCase()} reports.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((report) => (
          <ReportCard key={report.id} report={report} onChanged={reload} />
        ))}
      </ul>
      {next && (
        <Button
          tone="neutral"
          onClick={() => {
            api
              .reports(status, next)
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
