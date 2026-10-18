import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MatchesModule } from '../matches/matches.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { LobbyController } from './lobby.controller.js';
import { LobbyTimersService } from './lobby-timers.service.js';
import { MatchmakingService } from './matchmaking.service.js';
import { RoomsService } from './rooms.service.js';

@Module({
  imports: [AuthModule, MatchesModule, WalletModule],
  controllers: [LobbyController],
  providers: [MatchmakingService, RoomsService, LobbyTimersService],
  exports: [MatchmakingService, RoomsService],
})
export class LobbyModule {}
