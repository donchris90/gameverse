import {
  initialVoiceState,
  isVoiceActive,
  voiceReducer,
  type VoiceEvent,
  type VoiceState,
} from './voice-ui.js';
import type { VoiceSessionView, VoiceTokenView } from './voice.js';

export type MicPermission = 'granted' | 'denied' | 'blocked';
export type EngineConnection = 'connected' | 'reconnecting' | 'failed';

/** What the controller needs from a voice vendor. Agora implements it on the phone. */
export interface VoiceEngineListener {
  onJoined(): void;
  onConnection(state: EngineConnection): void;
  onRemoteJoined(uid: number): void;
  onRemoteLeft(uid: number): void;
  onRemoteMuted(uid: number, muted: boolean): void;
  onVolumes(levels: { uid: number; level: number }[]): void;
  /** The token is about to expire; ask the server for a new one. */
  onTokenWillExpire(): void;
  onError(message: string): void;
}

export interface VoiceEngine {
  setListener(listener: VoiceEngineListener | null): void;
  join(grant: Pick<VoiceTokenView, 'appId' | 'channel' | 'uid' | 'token'>): Promise<void>;
  renewToken(token: string): Promise<void>;
  setMuted(muted: boolean): void;
  leave(): Promise<void>;
  release(): void;
}

/** The server calls the controller uses; failures carry the API error code in `code`. */
export interface VoiceApi {
  token(): Promise<VoiceTokenView>;
  joined(): Promise<VoiceSessionView>;
  left(): Promise<unknown>;
}

export interface VoiceControllerDeps {
  api: VoiceApi;
  engine: VoiceEngine;
  requestMic(): Promise<MicPermission>;
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const codeOf = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Voice failed. Try again.';

/**
 * Runs one player's voice for one match: microphone permission, token, engine, renewal,
 * reconnect, usage logging and leaving. Platform parts are injected, so the whole flow is tested
 * with a fake engine and a fake API. Voice is always opt-in: nothing happens until `join()`.
 */
export class VoiceController implements VoiceEngineListener {
  private current: VoiceState = initialVoiceState;
  private listeners = new Set<(state: VoiceState) => void>();
  private generation = 0;
  private renewTimer: unknown = null;
  private renewing = false;

  constructor(private readonly deps: VoiceControllerDeps) {}

  get state(): VoiceState {
    return this.current;
  }

  subscribe(listener: (state: VoiceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private dispatch(event: VoiceEvent): void {
    const next = voiceReducer(this.current, event);
    if (next === this.current) return;
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }

  async join(): Promise<void> {
    if (
      this.current.phase !== 'off' &&
      !['denied', 'unavailable', 'error'].includes(this.current.phase)
    ) {
      return;
    }
    const run = (this.generation += 1);
    this.dispatch({ type: 'join_requested' });
    try {
      const permission = await this.deps.requestMic();
      if (run !== this.generation) return;
      if (permission !== 'granted') {
        this.dispatch({ type: 'permission_denied', canAskAgain: permission === 'denied' });
        return;
      }
      const grant = await this.deps.api.token();
      if (run !== this.generation) return;
      this.dispatch({ type: 'token_granted', grant, nowMs: this.deps.now() });
      this.deps.engine.setListener(this);
      await this.deps.engine.join(grant);
      if (run !== this.generation) return;
      this.deps.engine.setMuted(this.current.muted);
      this.scheduleRenewal();
    } catch (error) {
      if (run !== this.generation) return;
      await this.teardownEngine();
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    const code = codeOf(error);
    if (code === 'VOICE_UNAVAILABLE' || code === 'SERVICE_UNAVAILABLE' || code === 'NOT_FOUND') {
      this.dispatch({ type: 'unavailable', message: messageOf(error) });
    } else {
      this.dispatch({ type: 'failed', message: messageOf(error) });
    }
  }

  private async teardownEngine(): Promise<void> {
    this.clearRenewal();
    try {
      await this.deps.engine.leave();
    } catch {
      // Leaving a channel that never opened can fail; there is nothing more to undo.
    }
  }

  /** Leaves the channel. Safe to call at any time, including while still joining. */
  async leave(): Promise<void> {
    const wasActive = isVoiceActive(this.current);
    this.generation += 1;
    await this.teardownEngine();
    this.dispatch({ type: 'left' });
    if (wasActive) {
      try {
        await this.deps.api.left();
      } catch {
        // Usage logging is best effort; the server closes stale sessions itself.
      }
    }
  }

  /** The match ended or the player left it: voice ends with it. */
  matchEnded(): Promise<void> {
    return this.leave();
  }

  toggleMute(): void {
    this.dispatch({ type: 'mute_toggled' });
    if (isVoiceActive(this.current)) this.deps.engine.setMuted(this.current.muted);
  }

  dispose(): void {
    this.generation += 1;
    this.clearRenewal();
    this.deps.engine.setListener(null);
    this.listeners.clear();
    this.deps.engine.release();
  }

  // ------------------------------------------------------------------ renewal

  private scheduleRenewal(): void {
    this.clearRenewal();
    const renewAt = this.current.renewAt;
    if (renewAt === null) return;
    const delay = Math.max(0, renewAt - this.deps.now());
    this.renewTimer = this.deps.setTimer(() => void this.renew(), delay);
  }

  private clearRenewal(): void {
    if (this.renewTimer !== null) this.deps.clearTimer(this.renewTimer);
    this.renewTimer = null;
  }

  /** Fetches a fresh token and hands it to the engine. A refusal ends voice (blocked, match over). */
  async renew(): Promise<void> {
    if (this.renewing || !isVoiceActive(this.current) || this.current.myUid === null) return;
    this.renewing = true;
    const run = this.generation;
    try {
      const grant = await this.deps.api.token();
      if (run !== this.generation) return;
      await this.deps.engine.renewToken(grant.token);
      this.dispatch({ type: 'token_renewed', grant, nowMs: this.deps.now() });
      this.scheduleRenewal();
    } catch (error) {
      if (run !== this.generation) return;
      const code = codeOf(error);
      if (code === 'VOICE_UNAVAILABLE' || code === 'NOT_FOUND') {
        await this.leave();
        this.dispatch({ type: 'unavailable', message: messageOf(error) });
      } else {
        // Network trouble: try again shortly, well before the old token runs out.
        this.renewTimer = this.deps.setTimer(() => void this.renew(), 10_000);
      }
    } finally {
      this.renewing = false;
    }
  }

  // ------------------------------------------------------------ engine events

  onJoined(): void {
    this.dispatch({ type: 'engine_joined' });
    void this.deps.api.joined().catch(() => undefined);
  }

  onConnection(state: EngineConnection): void {
    if (state === 'reconnecting') this.dispatch({ type: 'connection_lost' });
    else if (state === 'connected') {
      this.dispatch({ type: 'connection_restored' });
    } else {
      void this.leave().then(() =>
        this.dispatch({ type: 'failed', message: 'Voice connection failed.' }),
      );
    }
  }

  onRemoteJoined(uid: number): void {
    this.dispatch({ type: 'remote_joined', uid });
  }

  onRemoteLeft(uid: number): void {
    this.dispatch({ type: 'remote_left', uid });
  }

  onRemoteMuted(uid: number, muted: boolean): void {
    this.dispatch({ type: 'remote_muted', uid, muted });
  }

  onVolumes(levels: { uid: number; level: number }[]): void {
    this.dispatch({ type: 'volumes', levels });
  }

  onTokenWillExpire(): void {
    void this.renew();
  }

  onError(message: string): void {
    this.dispatch({ type: 'failed', message });
  }
}
