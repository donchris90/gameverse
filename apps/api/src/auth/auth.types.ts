import type {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  socialLoginSchema,
  verifyEmailSchema,
  UserRole,
  UserStatus,
} from '@gameverse/shared-types';
import type { Request } from 'express';
import type { z } from 'zod';

export type RegisterBody = z.output<typeof registerSchema>;
export type LoginBody = z.output<typeof loginSchema>;
export type RefreshBody = z.output<typeof refreshSchema>;
export type LogoutBody = z.output<typeof logoutSchema>;
export type VerifyEmailBody = z.output<typeof verifyEmailSchema>;
export type ForgotPasswordBody = z.output<typeof forgotPasswordSchema>;
export type ResetPasswordBody = z.output<typeof resetPasswordSchema>;
export type SocialLoginBody = z.output<typeof socialLoginSchema>;

/** The authenticated principal attached to the request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
}

export type AuthenticatedRequest = Request & { user: AuthUser };
