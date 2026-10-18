import { COIN_AMOUNT_MAX, COIN_SETTING_KEYS, type CoinSettingKey } from '@gameverse/shared-types';
import { useCallback, useState } from 'react';
import { api } from '../api.js';
import { ErrorNote, styles, useLoad } from '../ui.js';
import { ReasonForm } from './ReasonForm.js';

const LABELS: Record<CoinSettingKey, string> = {
  starter: 'Welcome bonus (once per player)',
  daily: 'Daily check-in',
  levelUp: 'Reward for each new level',
};

/**
 * Bonus coins are free play credit for match entry fees and pots. They cannot be bought, sent,
 * withdrawn or exchanged. Admins change the earning amounts and can fix a single player's balance.
 */
export function Coins() {
  const load = useCallback(() => api.coinSettings(), []);
  const { data, error, loading, reload } = useLoad(load);
  const [draft, setDraft] = useState<Partial<Record<CoinSettingKey, string>>>({});
  const [saving, setSaving] = useState(false);

  const changes: Partial<Record<CoinSettingKey, number>> = {};
  for (const key of COIN_SETTING_KEYS) {
    const raw = draft[key];
    if (raw === undefined || raw.trim() === '' || !data) continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 0 && value <= COIN_AMOUNT_MAX && value !== data[key]) {
      changes[key] = value;
    }
  }
  const changed = Object.keys(changes).length > 0;

  return (
    <div>
      <h2>Bonus coins</h2>
      <p style={styles.muted}>
        Free play coins for match entry fees and pots. They cannot be bought, sent to another player
        or withdrawn. Changes are recorded in the audit log with your reason.
      </p>
      <ErrorNote error={error} />
      {loading && !data && <p style={styles.muted}>Loading…</p>}
      {data && (
        <section style={{ ...styles.card, marginBottom: 16 }}>
          <h3>Earning amounts</h3>
          {COIN_SETTING_KEYS.map((key) => (
            <label key={key} style={{ display: 'block', marginBottom: 8 }}>
              <span style={styles.muted}>
                {LABELS[key]} (now {String(data[key])})
              </span>
              <input
                inputMode="numeric"
                value={draft[key] ?? ''}
                placeholder={String(data[key])}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                style={{ ...styles.input, display: 'block' }}
              />
            </label>
          ))}
          {changed && (
            <ReasonForm
              label={saving ? 'Saving…' : 'Save changes'}
              onSubmit={async (reason) => {
                setSaving(true);
                try {
                  await api.setCoinSettings(changes, reason);
                  setDraft({});
                  reload();
                } finally {
                  setSaving(false);
                }
              }}
              onCancel={() => setDraft({})}
            />
          )}
        </section>
      )}
      <Adjust />
    </div>
  );
}

function Adjust() {
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  // One key per attempt: pressing the button twice cannot pay twice.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const value = Number(amount);
  const ready =
    userId.trim().length > 0 &&
    Number.isInteger(value) &&
    value !== 0 &&
    Math.abs(value) <= COIN_AMOUNT_MAX;

  return (
    <section style={styles.card}>
      <h3>Fix one player&apos;s balance</h3>
      <p style={styles.muted}>
        Use the player&apos;s id from the Users tab. A positive number adds coins, a negative number
        takes them back (never below zero).
      </p>
      <label style={{ display: 'block', marginBottom: 8 }}>
        <span style={styles.muted}>Player id</span>
        <input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          style={{ ...styles.input, display: 'block', width: '100%', boxSizing: 'border-box' }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        <span style={styles.muted}>Amount (for example 200 or -50)</span>
        <input
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          style={{ ...styles.input, display: 'block' }}
        />
      </label>
      <ErrorNote error={error} />
      {result && <p>{result}</p>}
      {ready && (
        <ReasonForm
          label={value > 0 ? `Add ${String(value)} coins` : `Take back ${String(-value)} coins`}
          tone={value > 0 ? 'primary' : 'danger'}
          onSubmit={async (reason) => {
            setError(null);
            try {
              const wallet = await api.adjustCoins(userId.trim(), value, reason, key);
              setResult(`Done. New balance: ${String(wallet.balance)} coins.`);
              setAmount('');
              setKey(crypto.randomUUID());
            } catch (err) {
              setError(err);
            }
          }}
          onCancel={() => {
            setAmount('');
            setResult(null);
          }}
        />
      )}
    </section>
  );
}
