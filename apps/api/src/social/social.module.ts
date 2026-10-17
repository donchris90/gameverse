import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BlocksService } from './blocks.service.js';
import { FriendsService } from './friends.service.js';
import { SocialController } from './social.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [SocialController],
  providers: [FriendsService, BlocksService],
  exports: [FriendsService, BlocksService],
})
export class SocialModule {}
