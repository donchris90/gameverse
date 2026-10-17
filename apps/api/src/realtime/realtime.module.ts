import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PresenceController } from './presence.controller.js';
import { PresenceService } from './presence.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeHub } from './realtime.hub.js';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [PresenceController],
  providers: [RealtimeHub, RealtimeGateway, PresenceService],
  exports: [RealtimeHub],
})
export class RealtimeModule {}
