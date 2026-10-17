import { Inject, Injectable } from '@nestjs/common';
import agoraToken from 'agora-token';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

// agora-token is CommonJS: named imports work under Vitest but fail in the compiled app under Node.
const { RtcRole, RtcTokenBuilder } = agoraToken;

export interface VoiceTokenRequest {
  channel: string;
  /** Agora numeric user id (uint32, non-zero). */
  uid: number;
  ttlSeconds: number;
}

export interface VoiceTokenGrant {
  appId: string;
  channel: string;
  uid: number;
  token: string;
  expiresAt: Date;
}

/** Thrown when the voice provider has no credentials. The API maps it to 503. */
export class VoiceNotConfiguredError extends Error {
  constructor() {
    super('Voice provider credentials are not configured');
    this.name = 'VoiceNotConfiguredError';
  }
}

/** Seam between game code and the voice vendor, so a fake can stand in during tests. */
export abstract class VoiceProvider {
  abstract issueToken(request: VoiceTokenRequest, now?: Date): VoiceTokenGrant;
}

@Injectable()
export class AgoraVoiceProvider extends VoiceProvider {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  issueToken(request: VoiceTokenRequest, now: Date = new Date()): VoiceTokenGrant {
    const { AGORA_APP_ID: appId, AGORA_APP_CERTIFICATE: certificate } = this.config;
    if (!appId || !certificate) throw new VoiceNotConfiguredError();

    const issuedAt = Math.floor(now.getTime() / 1000);
    const expireAt = issuedAt + request.ttlSeconds;
    // Publisher role: both phones speak and listen. The token expires at `expireAt` for both the
    // token itself and the privilege, so a leaked token is short-lived.
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      certificate,
      request.channel,
      request.uid,
      RtcRole.PUBLISHER,
      expireAt,
      expireAt,
    );
    return {
      appId,
      channel: request.channel,
      uid: request.uid,
      token,
      expiresAt: new Date(expireAt * 1000),
    };
  }
}
