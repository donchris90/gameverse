import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { DailyClaimView, WalletView } from '@gameverse/shared-types';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WalletService } from './wallet.service.js';

/**
 * A player's own bonus coins. Read the balance and claim the daily check-in; nothing else.
 * There is deliberately no route to send, sell or withdraw coins (decision #110).
 */
@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser): Promise<WalletView> {
    return this.wallet.view(user.id);
  }

  @Post('daily')
  @HttpCode(HttpStatus.OK)
  claimDaily(@CurrentUser() user: AuthUser): Promise<DailyClaimView> {
    return this.wallet.claimDaily(user.id);
  }
}
