import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  type AuthSession,
  type MessageResponse,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  socialLoginSchema,
  verifyEmailSchema,
} from '@gameverse/shared-types';
import type { Request } from 'express';
import { requestMeta } from '../common/request-meta.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import type {
  ForgotPasswordBody,
  LoginBody,
  LogoutBody,
  RefreshBody,
  RegisterBody,
  ResetPasswordBody,
  SocialLoginBody,
  VerifyEmailBody,
  AuthUser,
} from './auth.types.js';
import { CurrentUser } from './current-user.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/**
 * All routes here are rate limited per client IP by the "auth" throttler, and login is additionally
 * limited per email address (see rate-limit.ts).
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterBody,
    @Req() request: Request,
  ): Promise<AuthSession> {
    return this.auth.register(body, requestMeta(request));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
    @Req() request: Request,
  ): Promise<AuthSession> {
    return this.auth.login(body, requestMeta(request));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshBody,
    @Req() request: Request,
  ): Promise<AuthSession> {
    return this.auth.refresh(body.refreshToken, requestMeta(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body(new ZodValidationPipe(logoutSchema)) body: LogoutBody): Promise<MessageResponse> {
    return this.auth.logout(body.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  logoutAll(@CurrentUser() user: AuthUser): Promise<MessageResponse> {
    return this.auth.logoutAll(user.id);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailBody,
  ): Promise<MessageResponse> {
    return this.auth.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  resendVerification(@CurrentUser() user: AuthUser): Promise<MessageResponse> {
    return this.auth.resendVerification(user.id);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordBody,
  ): Promise<MessageResponse> {
    return this.auth.forgotPassword(body);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordBody,
  ): Promise<MessageResponse> {
    return this.auth.resetPassword(body);
  }

  @Post('social')
  @HttpCode(HttpStatus.OK)
  social(
    @Body(new ZodValidationPipe(socialLoginSchema)) body: SocialLoginBody,
    @Req() request: Request,
  ): Promise<AuthSession> {
    return this.auth.socialLogin(body, requestMeta(request));
  }
}
