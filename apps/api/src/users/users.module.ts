import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MailModule } from '../mail/mail.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { UsersController } from './users.controller.js';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [UsersController, AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class UsersModule {}
