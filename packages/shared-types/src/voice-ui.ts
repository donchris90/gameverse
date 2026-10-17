import type { VoiceParticipantView, VoiceTokenView } from './voice.js';

/**
 * The phone-side voice state machine. It is a pure reducer so every decision about what the
 * voice panel shows (joining, connected, reconnecting, permission denied, who is speaking) is
 * unit-tested here instead of inside React components.
 */

export type VoicePhase =
  | 'off'
  | 'requesting' // asking for the microphone, then for a token
  | 'joining' // token in hand, engine connecting
  | 'connected'
  | 'reconnecting'
  | 'denied' // microphone permission refused
  | 'unavailable' // the server refused (bot match, blocked, match over, not configured)
  | 'error';

export interface VoiceState {
  phase: VoicePhase;
  muted: boolean;
  /** Players who may be in the channel (from the token). */
  participants: VoiceParticipantView[];
  /** Agora uids currently in the channel, the local player included once connected. */
  present: number[];
  /** Agora uids currently speaking. */
  speaking: number[];
  /** Agora uids that muted themselves. */
  remoteMuted: number[];
  myUid: number | null;
  /** Epoch ms (phone clock) at which to fetch a fresh token. */
  renewAt: number | null;
  /** For `denied`: false when the system will not show the prompt again (open settings). */
  canAskAgain: boolean;
  message: string | null;
}

export const initialVoiceState: VoiceState = {
  phase: 'off',
  muted: false,
  participants: [],
  present: [],
  speaking: [],
  remoteMuted: [],
  myUid: null,
  renewAt: null,
  canAskAgain: true,
  message: null,
};

/** Agora reports volume 0-255; above this a person counts as speaking. */
export const SPEAKING_LEVEL = 20;

export type VoiceEvent =
  | { type: 'join_requested' }
  | { type: 'permission_denied'; canAskAgain: boolean }
  | { type: 'token_granted'; grant: VoiceTokenView; nowMs: number }
  | { type: 'token_renewed'; grant: VoiceTokenView; nowMs: number }
  | { type: 'engine_joined' }
  | { type: 'connection_lost' }
  | { type: 'connection_restored' }
  | { type: 'remote_joined'; uid: number }
  | { type: 'remote_left'; uid: number }
  | { type: 'remote_muted'; uid: number; muted: boolean }
  | { type: 'volumes'; levels: { uid: number; level: number }[] }
  | { type: 'mute_toggled' }
  | { type: 'unavailable'; message: string }
  | { type: 'failed'; message: string }
  | { type: 'left' };

const without = (list: number[], uid: number): number[] => list.filter((item) => item !== uid);
const withUid = (list: number[], uid: number): number[] =>
  list.includes(uid) ? list : [...list, uid];

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case 'join_requested':
      // Only an idle (or failed) panel may start a join; repeated taps are ignored.
      if (!['off', 'denied', 'unavailable', 'error'].includes(state.phase)) return state;
      return { ...initialVoiceState, muted: state.muted, phase: 'requesting' };
    case 'permission_denied':
      return {
        ...initialVoiceState,
        phase: 'denied',
        canAskAgain: event.canAskAgain,
        message: event.canAskAgain
          ? 'Voice needs the microphone. Allow it to talk.'
          : 'Microphone is blocked. Turn it on in Settings to talk.',
      };
    case 'token_granted':
      if (state.phase !== 'requesting') return state;
      return {
        ...state,
        phase: 'joining',
        participants: event.grant.participants,
        myUid: event.grant.uid,
        renewAt: renewAtFor(event.grant, event.nowMs),
      };
    case 'token_renewed':
      if (state.myUid === null) return state;
      return {
        ...state,
        participants: event.grant.participants,
        renewAt: renewAtFor(event.grant, event.nowMs),
      };
    case 'engine_joined':
      if (state.phase !== 'joining' && state.phase !== 'reconnecting') return state;
      return {
        ...state,
        phase: 'connected',
        present: state.myUid === null ? state.present : withUid(state.present, state.myUid),
      };
    case 'connection_lost':
      if (state.phase !== 'connected') return state;
      return {
        ...state,
        phase: 'reconnecting',
        speaking: [],
        message: 'Connection lost. Reconnecting…',
      };
    case 'connection_restored':
      if (state.phase !== 'reconnecting') return state;
      return { ...state, phase: 'connected', message: null };
    case 'remote_joined':
      return { ...state, present: withUid(state.present, event.uid) };
    case 'remote_left':
      return {
        ...state,
        present: without(state.present, event.uid),
        speaking: without(state.speaking, event.uid),
        remoteMuted: without(state.remoteMuted, event.uid),
      };
    case 'remote_muted':
      return {
        ...state,
        remoteMuted: event.muted
          ? withUid(state.remoteMuted, event.uid)
          : without(state.remoteMuted, event.uid),
      };
    case 'volumes': {
      if (state.phase !== 'connected') return state;
      const speaking = event.levels
        // The engine reports the local microphone as uid 0.
        .map((entry) => ({
          uid: entry.uid === 0 && state.myUid !== null ? state.myUid : entry.uid,
          level: entry.level,
        }))
        .filter((entry) => entry.level > SPEAKING_LEVEL)
        .filter((entry) => !(entry.uid === state.myUid && state.muted))
        .map((entry) => entry.uid);
      return { ...state, speaking };
    }
    case 'mute_toggled': {
      const muted = !state.muted;
      return {
        ...state,
        muted,
        speaking:
          muted && state.myUid !== null ? without(state.speaking, state.myUid) : state.speaking,
      };
    }
    case 'unavailable':
      return {
        ...initialVoiceState,
        muted: state.muted,
        phase: 'unavailable',
        message: event.message,
      };
    case 'failed':
      return { ...initialVoiceState, muted: state.muted, phase: 'error', message: event.message };
    case 'left':
      return { ...initialVoiceState, muted: state.muted };
  }
}

function renewAtFor(grant: VoiceTokenView, nowMs: number): number {
  return nowMs + grant.renewInSeconds * 1000;
}

export const isVoiceActive = (state: VoiceState): boolean =>
  state.phase === 'requesting' ||
  state.phase === 'joining' ||
  state.phase === 'connected' ||
  state.phase === 'reconnecting';

export interface VoiceRow {
  uid: number;
  userId: string;
  name: string;
  avatarId: string;
  isMe: boolean;
  inChannel: boolean;
  speaking: boolean;
  muted: boolean;
}

/** One row per player for the participant list. */
export function voiceRows(state: VoiceState, myUserId: string): VoiceRow[] {
  return state.participants.map((participant) => {
    const isMe = participant.userId === myUserId;
    return {
      uid: participant.uid,
      userId: participant.userId,
      name: isMe ? 'You' : participant.username,
      avatarId: participant.avatarId,
      isMe,
      inChannel: state.present.includes(participant.uid),
      speaking: state.speaking.includes(participant.uid),
      muted: isMe ? state.muted : state.remoteMuted.includes(participant.uid),
    };
  });
}

export function voiceStatusText(state: VoiceState): string {
  switch (state.phase) {
    case 'off':
      return 'Voice is off';
    case 'requesting':
      return 'Getting ready…';
    case 'joining':
      return 'Connecting…';
    case 'connected':
      return state.muted ? 'Connected. Your microphone is off' : 'Connected';
    case 'reconnecting':
      return 'Connection lost. Reconnecting…';
    case 'denied':
    case 'unavailable':
    case 'error':
      return state.message ?? 'Voice is not available';
  }
}

/** Should the app ask the server for a fresh token now? */
export function shouldRenew(state: VoiceState, nowMs: number): boolean {
  return (
    (state.phase === 'connected' || state.phase === 'reconnecting' || state.phase === 'joining') &&
    state.renewAt !== null &&
    nowMs >= state.renewAt
  );
}
