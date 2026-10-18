import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { ProgressController } from './progress.controller.js';
import { ProgressService } from './progress.service.js';
import { ResultsService } from './results.service.js';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [ProgressController],
  providers: [ProgressService, ResultsService],
  exports: [ResultsService, ProgressService],
})
export class ProgressModule {}
