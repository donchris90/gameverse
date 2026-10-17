import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { VoiceSpikeController } from './voice-spike.controller.js';
import { AgoraVoiceProvider, VoiceProvider } from './voice.provider.js';

@Module({
  imports: [AuthModule],
  controllers: [VoiceSpikeController],
  providers: [{ provide: VoiceProvider, useClass: AgoraVoiceProvider }],
  exports: [VoiceProvider],
})
export class VoiceModule {}
