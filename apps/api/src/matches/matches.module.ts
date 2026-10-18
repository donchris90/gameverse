import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProgressModule } from '../progress/progress.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { EntryService } from './entry.service.js';
import { MatchTimersService } from './match-timers.service.js';
import { MatchesController } from './matches.controller.js';
import { MatchesService } from './matches.service.js';

@Module({
  imports: [AuthModule, ProgressModule, WalletModule],
  controllers: [MatchesController],
  providers: [MatchesService, MatchTimersService, EntryService],
  exports: [MatchesService, EntryService],
})
export class MatchesModule {}
