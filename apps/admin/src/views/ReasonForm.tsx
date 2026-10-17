import {
  MODERATION_REASON_MAX_LENGTH,
  MODERATION_REASON_MIN_LENGTH,
} from '@gameverse/shared-types';
import { useState } from 'react';
import { Button, ErrorNote, styles } from '../ui.js';

/** Every staff action needs a written reason; it is stored in the audit log. */
export function ReasonForm(props: {
  label: string;
  tone?: 'primary' | 'danger' | 'neutral';
  onSubmit: (reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const trimmed = reason.trim();
  const valid = trimmed.length >= MODERATION_REASON_MIN_LENGTH;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        setError(null);
        props
          .onSubmit(trimmed)
          .catch((err: unknown) => setError(err))
          .finally(() => setBusy(false));
      }}
    >
      <label>
        <span style={styles.muted}>
          Reason (at least {MODERATION_REASON_MIN_LENGTH} characters, kept in the audit log)
        </span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={MODERATION_REASON_MAX_LENGTH}
          rows={3}
          style={{ ...styles.input, display: 'block', width: '100%', boxSizing: 'border-box' }}
        />
      </label>
      <ErrorNote error={error} />
      <div style={{ ...styles.row, marginTop: 8 }}>
        <Button type="submit" tone={props.tone ?? 'primary'} disabled={!valid || busy}>
          {busy ? 'Working…' : props.label}
        </Button>
        <Button tone="neutral" onClick={props.onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
