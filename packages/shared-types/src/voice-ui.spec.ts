import { describe, expect, it } from 'vitest';
import {
  initialVoiceState,
  isVoiceActive,
  shouldRenew,
  voiceReducer,
  voiceRows,
  voiceStatusText,
  type VoiceEvent,
  type VoiceState,
} from './voice-ui.js';
import type { VoiceTokenView } from './voice.js';

const grant = (over: Partial<VoiceTokenView> = {}): VoiceTokenView => ({
  appId: 'app',
  channel: 'match_x',
  uid: 1,
  token: 't',
  expiresAt: '2026-10-19T10:10:00.000Z',
  serverTime: '2026-10-19T10:00:00.000Z',
  renewInSeconds: 540,
  participants: [
    { uid: 1, userId: 'me', username: 'Ada', avatarId: 'avatar-01' },
    { uid: 2, userId: 'them', username: 'Bayo', avatarId: 'avatar-02' },
  ],
  ...over,
});

const run = (events: VoiceEvent[], from: VoiceState = initialVoiceState): VoiceState =>
  events.reduce(voiceReducer, from);

const connected = run([
  { type: 'join_requested' },
  { type: 'token_granted', grant: grant(), nowMs: 1000 },
  { type: 'engine_joined' },
]);

describe('joining', () => {
  it('walks off → requesting → joining → connected, keeping the renew time', () => {
    expect(run([{ type: 'join_requested' }]).phase).toBe('requesting');
    const joining = run([
      { type: 'join_requested' },
      { type: 'token_granted', grant: grant(), nowMs: 1000 },
    ]);
    expect(joining).toMatchObject({ phase: 'joining', myUid: 1, renewAt: 1000 + 540_000 });
    expect(connected.phase).toBe('connected');
    expect(connected.present).toEqual([1]);
  });

  it('ignores a second join request and a token nobody asked for', () => {
    expect(voiceReducer(connected, { type: 'join_requested' })).toBe(connected);
    expect(
      voiceReducer(initialVoiceState, { type: 'token_granted', grant: grant(), nowMs: 0 }),
    ).toBe(initialVoiceState);
  });

  it('permission denied explains itself, and says when settings are needed', () => {
    const asked = run([
      { type: 'join_requested' },
      { type: 'permission_denied', canAskAgain: true },
    ]);
    expect(asked).toMatchObject({ phase: 'denied', canAskAgain: true });
    expect(voiceStatusText(asked)).toContain('Allow it');
    const blocked = run([
      { type: 'join_requested' },
      { type: 'permission_denied', canAskAgain: false },
    ]);
    expect(blocked.canAskAgain).toBe(false);
    expect(voiceStatusText(blocked)).toContain('Settings');
  });

  it('can try again after a denial, an error or an unavailable answer', () => {
    for (const event of [
      { type: 'permission_denied', canAskAgain: true },
      { type: 'failed', message: 'x' },
      { type: 'unavailable', message: 'y' },
    ] as VoiceEvent[]) {
      const stuck = run([{ type: 'join_requested' }, event]);
      expect(voiceReducer(stuck, { type: 'join_requested' }).phase).toBe('requesting');
    }
  });
});

describe('while connected', () => {
  it('tracks the other player coming and going, and clears their speaking state', () => {
    let state = run(
      [
        { type: 'remote_joined', uid: 2 },
        { type: 'volumes', levels: [{ uid: 2, level: 90 }] },
      ],
      connected,
    );
    expect(state.present).toEqual([1, 2]);
    expect(state.speaking).toEqual([2]);
    state = run([{ type: 'remote_left', uid: 2 }], state);
    expect(state.present).toEqual([1]);
    expect(state.speaking).toEqual([]);
  });

  it('only loud enough counts as speaking, and the local mic (uid 0) is mapped to me', () => {
    const state = run(
      [
        {
          type: 'volumes',
          levels: [
            { uid: 0, level: 200 },
            { uid: 2, level: 10 },
          ],
        },
      ],
      connected,
    );
    expect(state.speaking).toEqual([1]);
  });

  it('a muted player is never shown as speaking', () => {
    const state = run(
      [{ type: 'mute_toggled' }, { type: 'volumes', levels: [{ uid: 0, level: 255 }] }],
      connected,
    );
    expect(state.muted).toBe(true);
    expect(state.speaking).toEqual([]);
    expect(voiceStatusText(state)).toContain('microphone is off');
  });

  it('muting while speaking removes the indicator at once; unmuting restores the choice', () => {
    const speaking = run([{ type: 'volumes', levels: [{ uid: 0, level: 200 }] }], connected);
    expect(speaking.speaking).toEqual([1]);
    const muted = voiceReducer(speaking, { type: 'mute_toggled' });
    expect(muted.speaking).toEqual([]);
    expect(voiceReducer(muted, { type: 'mute_toggled' }).muted).toBe(false);
  });

  it('remembers who muted themselves', () => {
    const state = run([{ type: 'remote_muted', uid: 2, muted: true }], connected);
    expect(state.remoteMuted).toEqual([2]);
    expect(run([{ type: 'remote_muted', uid: 2, muted: false }], state).remoteMuted).toEqual([]);
  });

  it('volume reports are ignored when not connected', () => {
    const state = run([
      { type: 'join_requested' },
      { type: 'volumes', levels: [{ uid: 2, level: 200 }] },
    ]);
    expect(state.speaking).toEqual([]);
  });
});

describe('reconnecting and leaving', () => {
  it('goes to reconnecting and back, and stops showing speakers while away', () => {
    const speaking = run(
      [
        { type: 'remote_joined', uid: 2 },
        { type: 'volumes', levels: [{ uid: 2, level: 99 }] },
      ],
      connected,
    );
    const lost = voiceReducer(speaking, { type: 'connection_lost' });
    expect(lost).toMatchObject({ phase: 'reconnecting', speaking: [] });
    expect(voiceStatusText(lost)).toContain('Reconnecting');
    expect(voiceReducer(lost, { type: 'connection_restored' }).phase).toBe('connected');
    expect(voiceReducer(initialVoiceState, { type: 'connection_lost' })).toBe(initialVoiceState);
  });

  it('leaving resets everything except the mute choice', () => {
    const state = run([{ type: 'mute_toggled' }, { type: 'left' }], connected);
    expect(state).toEqual({ ...initialVoiceState, muted: true });
    expect(isVoiceActive(state)).toBe(false);
  });

  it('is active only while requesting, joining, connected or reconnecting', () => {
    expect(isVoiceActive(connected)).toBe(true);
    expect(isVoiceActive(voiceReducer(connected, { type: 'connection_lost' }))).toBe(true);
    expect(isVoiceActive(initialVoiceState)).toBe(false);
    expect(isVoiceActive(run([{ type: 'join_requested' }, { type: 'failed', message: 'x' }]))).toBe(
      false,
    );
  });
});

describe('renewal', () => {
  it('is due once the renew time has passed, and not before or when off', () => {
    expect(shouldRenew(connected, 1000 + 539_999)).toBe(false);
    expect(shouldRenew(connected, 1000 + 540_000)).toBe(true);
    expect(shouldRenew(initialVoiceState, 10 ** 12)).toBe(false);
  });

  it('a renewed token moves the renew time forward', () => {
    const renewed = voiceReducer(connected, {
      type: 'token_renewed',
      grant: grant(),
      nowMs: 600_000,
    });
    expect(renewed.renewAt).toBe(600_000 + 540_000);
  });
});

describe('voiceRows', () => {
  it('lists both players with who is in the channel, speaking and muted', () => {
    const state = run(
      [
        { type: 'remote_joined', uid: 2 },
        { type: 'volumes', levels: [{ uid: 2, level: 120 }] },
        { type: 'remote_muted', uid: 2, muted: true },
      ],
      connected,
    );
    expect(voiceRows(state, 'me')).toEqual([
      {
        uid: 1,
        userId: 'me',
        name: 'You',
        avatarId: 'avatar-01',
        isMe: true,
        inChannel: true,
        speaking: false,
        muted: false,
      },
      {
        uid: 2,
        userId: 'them',
        name: 'Bayo',
        avatarId: 'avatar-02',
        isMe: false,
        inChannel: true,
        speaking: true,
        muted: true,
      },
    ]);
    expect(voiceRows(initialVoiceState, 'me')).toEqual([]);
  });
});
