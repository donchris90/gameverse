import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordService } from './password.service.js';
import {
  SOCIAL_KEY_RESOLVERS,
  SocialTokenVerifier,
  createRemoteKeyResolvers,
} from './social-token.verifier.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    SocialTokenVerifier,
    JwtAuthGuard,
    { provide: SOCIAL_KEY_RESOLVERS, useFactory: createRemoteKeyResolvers },
  ],
  exports: [JwtAuthGuard, TokenService],
})
export class AuthModule {}
