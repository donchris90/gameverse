import {
  ChannelProfileType,
  ClientRoleType,
  ConnectionStateType,
  createAgoraRtcEngine,
  type IRtcEngine,
} from 'react-native-agora';
import type { VoiceEngine, VoiceEngineListener, VoiceTokenView } from '@gameverse/shared-types';

/**
 * Agora implementation of the engine seam. It is deliberately thin: it forwards SDK callbacks to
 * the controller and holds no decisions of its own. Unverified on a device until
 * docs/voice-verification.md is filled in.
 */
export class AgoraVoiceEngine implements VoiceEngine {
  private rtc: IRtcEngine | null = null;
  private listener: VoiceEngineListener | null = null;

  setListener(listener: VoiceEngineListener | null): void {
    this.listener = listener;
  }

  async join(grant: Pick<VoiceTokenView, 'appId' | 'channel' | 'uid' | 'token'>): Promise<void> {
    this.release();
    const rtc = createAgoraRtcEngine();
    this.rtc = rtc;
    rtc.initialize({
      appId: grant.appId,
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
    });
    rtc.registerEventHandler({
      onJoinChannelSuccess: () => this.listener?.onJoined(),
      onUserJoined: (_connection, uid) => this.listener?.onRemoteJoined(uid),
      onUserOffline: (_connection, uid) => this.listener?.onRemoteLeft(uid),
      onUserMuteAudio: (_connection, uid, muted) => this.listener?.onRemoteMuted(uid, muted),
      onConnectionStateChanged: (_connection, state) => {
        if (state === ConnectionStateType.ConnectionStateReconnecting) {
          this.listener?.onConnection('reconnecting');
        } else if (state === ConnectionStateType.ConnectionStateConnected) {
          this.listener?.onConnection('connected');
        } else if (state === ConnectionStateType.ConnectionStateFailed) {
          this.listener?.onConnection('failed');
        }
      },
      onTokenPrivilegeWillExpire: () => this.listener?.onTokenWillExpire(),
      onAudioVolumeIndication: (_connection, speakers) =>
        this.listener?.onVolumes(
          speakers.map((speaker) => ({ uid: speaker.uid ?? 0, level: speaker.volume ?? 0 })),
        ),
      onError: (code, message) => this.listener?.onError(`Voice error ${String(code)}: ${message}`),
    });
    rtc.enableAudio();
    // Report who is speaking every 300 ms (the local microphone is reported as uid 0).
    rtc.enableAudioVolumeIndication(300, 3, true);
    const result = rtc.joinChannel(grant.token, grant.channel, grant.uid, {
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      publishMicrophoneTrack: true,
      autoSubscribeAudio: true,
    });
    if (typeof result === 'number' && result < 0) {
      throw new Error(`Could not join voice (code ${String(result)})`);
    }
  }

  async renewToken(token: string): Promise<void> {
    this.rtc?.renewToken(token);
  }

  setMuted(muted: boolean): void {
    this.rtc?.muteLocalAudioStream(muted);
  }

  async leave(): Promise<void> {
    this.rtc?.leaveChannel();
  }

  release(): void {
    const rtc = this.rtc;
    this.rtc = null;
    if (!rtc) return;
    try {
      rtc.unregisterEventHandler({});
    } catch {
      // The handler may already be gone.
    }
    rtc.release();
  }
}
