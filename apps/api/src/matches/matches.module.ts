import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProgressModule } from '../progress/progress.module.js';
import { MatchTimersService } from './match-timers.service.js';
import { MatchesController } from './matches.controller.js';
import { MatchesService } from './matches.service.js';

@Module({
  imports: [AuthModule, ProgressModule],
  controllers: [MatchesController],
  providers: [MatchesService, MatchTimersService],
  exports: [MatchesService],
})
export class MatchesModule {}
