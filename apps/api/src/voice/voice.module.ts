import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { VoiceSpikeController } from './voice-spike.controller.js';
import { VoiceController } from './voice.controller.js';
import { VoiceService } from './voice.service.js';
import { VoiceTimersService } from './voice-timers.service.js';
import { AgoraVoiceProvider, FakeVoiceProvider, VoiceProvider } from './voice.provider.js';

@Module({
  imports: [AuthModule],
  controllers: [VoiceController, VoiceSpikeController],
  providers: [
    {
      provide: VoiceProvider,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): VoiceProvider =>
        config.VOICE_PROVIDER === 'fake' ? new FakeVoiceProvider() : new AgoraVoiceProvider(config),
    },
    VoiceService,
    VoiceTimersService,
  ],
  exports: [VoiceProvider, VoiceService],
})
export class VoiceModule {}
