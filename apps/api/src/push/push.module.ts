import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PushController } from './push.controller.js';
import {
  DisabledPushProvider,
  ExpoPushProvider,
  MemoryPushProvider,
  PushProvider,
} from './push.provider.js';
import { PushService } from './push.service.js';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [
    {
      provide: PushProvider,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PushProvider => {
        switch (config.PUSH_PROVIDER) {
          case 'expo':
            return new ExpoPushProvider(config);
          case 'memory':
            return new MemoryPushProvider();
          default:
            return new DisabledPushProvider();
        }
      },
    },
    PushService,
  ],
  exports: [PushService, PushProvider],
})
export class PushModule {}
