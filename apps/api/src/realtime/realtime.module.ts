import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeHub } from './realtime.hub.js';

@Global()
@Module({
  imports: [AuthModule],
  providers: [RealtimeHub, RealtimeGateway],
  exports: [RealtimeHub],
})
export class RealtimeModule {}
