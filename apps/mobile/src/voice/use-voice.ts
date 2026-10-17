import { VoiceController, isVoiceActive, type VoiceState } from '@gameverse/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { voiceApi } from '../api-client';
import { AgoraVoiceEngine } from './agora-engine';
import { startVoiceKeepAlive, stopVoiceKeepAlive } from './keep-alive';
import { requestMicrophone } from './mic';

/**
 * One voice controller per match screen. Voice is off until the player taps Join. It ends when
 * the match is no longer open, and when the screen goes away. Unverified on a device.
 */
export function useVoice(matchId: string, matchOpen: boolean) {
  const controller = useMemo(
    () =>
      new VoiceController({
        api: voiceApi(matchId),
        engine: new AgoraVoiceEngine(),
        requestMic: requestMicrophone,
        now: () => Date.now(),
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      }),
    [matchId],
  );
  const [state, setState] = useState<VoiceState>(controller.state);

  useEffect(() => {
    setState(controller.state);
    const unsubscribe = controller.subscribe(setState);
    return () => {
      unsubscribe();
      void controller.leave().finally(() => controller.dispose());
    };
  }, [controller]);

  // Voice ends with the match.
  useEffect(() => {
    if (!matchOpen) void controller.matchEnded();
  }, [controller, matchOpen]);

  // Background audio: keep the microphone alive (Android foreground service) while in a call.
  const active = isVoiceActive(state);
  useEffect(() => {
    if (active) void startVoiceKeepAlive();
    else void stopVoiceKeepAlive();
  }, [active]);

  return { controller, state };
}
