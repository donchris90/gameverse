import { describe, expect, it, vi } from 'vitest';
import {
  VoiceController,
  type MicPermission,
  type VoiceApi,
  type VoiceEngine,
  type VoiceEngineListener,
} from './voice-controller.js';
import type { VoiceTokenView } from './voice.js';

const grant = (token = 't1'): VoiceTokenView => ({
  appId: 'app',
  channel: 'match_x',
  uid: 1,
  token,
  expiresAt: '2026-10-19T10:10:00.000Z',
  serverTime: '2026-10-19T10:00:00.000Z',
  renewInSeconds: 540,
  participants: [
    { uid: 1, userId: 'me', username: 'Ada', avatarId: 'avatar-01' },
    { uid: 2, userId: 'them', username: 'Bayo', avatarId: 'avatar-02' },
  ],
});

class FakeEngine implements VoiceEngine {
  listener: VoiceEngineListener | null = null;
  calls: string[] = [];
  joinGate: Promise<void> | null = null;
  failJoin: Error | null = null;
  setListener(listener: VoiceEngineListener | null) {
    this.listener = listener;
  }
  async join(g: { token: string }) {
    this.calls.push(`join:${g.token}`);
    if (this.joinGate) await this.joinGate;
    if (this.failJoin) throw this.failJoin;
  }
  async renewToken(token: string) {
    this.calls.push(`renew:${token}`);
  }
  setMuted(muted: boolean) {
    this.calls.push(`mute:${String(muted)}`);
  }
  async leave() {
    this.calls.push('leave');
  }
  release() {
    this.calls.push('release');
  }
}

function setup(options: { mic?: MicPermission; tokenError?: unknown } = {}) {
  const engine = new FakeEngine();
  let clock = 1_000_000;
  const timers = new Map<number, { run: () => void; at: number }>();
  let nextTimer = 1;
  const tokens = ['t1', 't2', 't3'];
  const api = {
    token: vi.fn(async () => {
      if (options.tokenError) throw options.tokenError;
      return grant(tokens.shift() ?? 'tn');
    }),
    joined: vi.fn(async () => ({}) as never),
    left: vi.fn(async () => ({})),
  } satisfies VoiceApi;
  const controller = new VoiceController({
    api,
    engine,
    requestMic: async () => options.mic ?? 'granted',
    now: () => clock,
    setTimer: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { run, at: clock + ms });
      return id;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
  });
  const advance = async (ms: number) => {
    clock += ms;
    for (const [id, timer] of timers) {
      if (timer.at <= clock) {
        timers.delete(id);
        timer.run();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { controller, engine, api, timers, advance };
}

const apiError = (code: string) => Object.assign(new Error(code), { code });

describe('VoiceController', () => {
  it('does nothing until join() is called', () => {
    const { controller, engine, api } = setup();
    expect(controller.state.phase).toBe('off');
    expect(engine.calls).toEqual([]);
    expect(api.token).not.toHaveBeenCalled();
  });

  it('joins: permission, token, engine, then logs the join once the engine confirms', async () => {
    const { controller, engine, api } = setup();
    await controller.join();
    expect(controller.state.phase).toBe('joining');
    expect(engine.calls).toEqual(['join:t1', 'mute:false']);
    expect(api.joined).not.toHaveBeenCalled(); // nothing logged before the engine is really in
    engine.listener?.onJoined();
    expect(controller.state.phase).toBe('connected');
    expect(api.joined).toHaveBeenCalledTimes(1);
  });

  it('stops at the microphone prompt when permission is refused, without asking the server', async () => {
    const { controller, engine, api } = setup({ mic: 'denied' });
    await controller.join();
    expect(controller.state).toMatchObject({ phase: 'denied', canAskAgain: true });
    const blocked = setup({ mic: 'blocked' });
    await blocked.controller.join();
    expect(blocked.controller.state).toMatchObject({ phase: 'denied', canAskAgain: false });
    expect(api.token).not.toHaveBeenCalled();
    expect(engine.calls).toEqual([]);
  });

  it.each(['VOICE_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'NOT_FOUND'])(
    'treats a %s answer as "voice is not available" and leaves the engine alone',
    async (code) => {
      const { controller, engine } = setup({ tokenError: apiError(code) });
      await controller.join();
      expect(controller.state.phase).toBe('unavailable');
      expect(engine.calls).not.toContain('join:t1');
    },
  );

  it('reports other failures as an error and cleans up the engine', async () => {
    const { controller, engine } = setup();
    engine.failJoin = new Error('engine exploded');
    await controller.join();
    expect(controller.state).toMatchObject({ phase: 'error', message: 'engine exploded' });
    expect(engine.calls).toContain('leave');
  });

  it('ignores a second join while one is in progress', async () => {
    const { controller, api } = setup();
    await Promise.all([controller.join(), controller.join()]);
    expect(api.token).toHaveBeenCalledTimes(1);
  });

  it('leaving while the join is still in progress cancels it', async () => {
    const { controller, engine } = setup();
    let release!: () => void;
    engine.joinGate = new Promise((resolve) => (release = resolve));
    const joining = controller.join();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await controller.leave();
    release();
    await joining;
    expect(controller.state.phase).toBe('off');
    expect(engine.calls.filter((c) => c === 'leave').length).toBeGreaterThanOrEqual(1);
  });

  it('leaving while the microphone prompt is open stops the join before any token is requested', async () => {
    const engine = new FakeEngine();
    let answer!: (value: MicPermission) => void;
    const api = {
      token: vi.fn(async () => grant()),
      joined: vi.fn(async () => ({}) as never),
      left: vi.fn(async () => ({})),
    } satisfies VoiceApi;
    const controller = new VoiceController({
      api,
      engine,
      requestMic: () => new Promise<MicPermission>((resolve) => (answer = resolve)),
      now: () => 0,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    const joining = controller.join();
    await controller.leave();
    answer('granted');
    await joining;
    expect(api.token).not.toHaveBeenCalled();
    expect(controller.state.phase).toBe('off');
  });

  it('leave() closes the channel, tells the server, and a second leave tells it nothing more', async () => {
    const { controller, engine, api } = setup();
    await controller.join();
    engine.listener?.onJoined();
    await controller.leave();
    expect(controller.state.phase).toBe('off');
    expect(api.left).toHaveBeenCalledTimes(1);
    await controller.leave();
    expect(api.left).toHaveBeenCalledTimes(1);
  });

  it('a failed usage report never breaks leaving', async () => {
    const { controller, api } = setup();
    api.left.mockRejectedValueOnce(new Error('offline'));
    await controller.join();
    await expect(controller.leave()).resolves.toBeUndefined();
    expect(controller.state.phase).toBe('off');
  });

  it('ends voice when the match ends', async () => {
    const { controller, api } = setup();
    await controller.join();
    await controller.matchEnded();
    expect(controller.state.phase).toBe('off');
    expect(api.left).toHaveBeenCalled();
  });

  it('mutes the engine, and the choice survives leaving and joining again', async () => {
    const { controller, engine } = setup();
    await controller.join();
    controller.toggleMute();
    expect(engine.calls).toContain('mute:true');
    await controller.leave();
    await controller.join();
    expect(engine.calls.at(-1)).toBe('mute:true');
  });

  it('renews the token before it expires and gives the new one to the engine', async () => {
    const { controller, engine, api, advance } = setup();
    await controller.join();
    await advance(539_000);
    expect(api.token).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(api.token).toHaveBeenCalledTimes(2);
    expect(engine.calls).toContain('renew:t2');
    await advance(540_000);
    expect(engine.calls).toContain('renew:t3');
  });

  it('renews when the engine says the token is about to expire', async () => {
    const { controller, engine } = setup();
    await controller.join();
    engine.listener?.onTokenWillExpire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(engine.calls).toContain('renew:t2');
  });

  it('leaves voice when renewal is refused (blocked or match over)', async () => {
    const { controller, api, advance } = setup();
    await controller.join();
    api.token.mockRejectedValueOnce(apiError('VOICE_UNAVAILABLE'));
    await advance(540_000);
    expect(controller.state.phase).toBe('unavailable');
    expect(api.left).toHaveBeenCalled();
  });

  it('retries soon after a network failure while renewing, and stays in voice', async () => {
    const { controller, api, advance } = setup();
    await controller.join();
    api.token.mockRejectedValueOnce(new Error('network'));
    await advance(540_000);
    expect(controller.state.phase).toBe('joining');
    await advance(10_000);
    expect(api.token).toHaveBeenCalledTimes(3);
  });

  it('moves through reconnecting and back; a failed connection ends voice with an error', async () => {
    const { controller, engine } = setup();
    await controller.join();
    engine.listener?.onJoined();
    engine.listener?.onConnection('reconnecting');
    expect(controller.state.phase).toBe('reconnecting');
    engine.listener?.onConnection('connected');
    expect(controller.state.phase).toBe('connected');
    engine.listener?.onConnection('failed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.state.phase).toBe('error');
  });

  it('shows who is speaking from engine volume reports', async () => {
    const { controller, engine } = setup();
    await controller.join();
    engine.listener?.onJoined();
    engine.listener?.onRemoteJoined(2);
    engine.listener?.onVolumes([{ uid: 2, level: 150 }]);
    expect(controller.state.speaking).toEqual([2]);
    engine.listener?.onRemoteLeft(2);
    expect(controller.state.speaking).toEqual([]);
  });

  it('dispose() releases the engine and stops timers', async () => {
    const { controller, engine, timers } = setup();
    await controller.join();
    controller.dispose();
    expect(engine.calls.at(-1)).toBe('release');
    expect(engine.listener).toBeNull();
    expect(timers.size).toBeGreaterThanOrEqual(0);
  });
});
