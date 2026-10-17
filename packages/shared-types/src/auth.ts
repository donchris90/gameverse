import { z } from 'zod';
import {
  CURRENT_TERMS_VERSION,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SOCIAL_PROVIDERS,
  type UserRole,
  type UserStatus,
} from './constants.js';
import { parseIsoDate } from './age.js';

/** Trimmed, lower-cased, syntactically valid email. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((value) => new Set(value).size > 3, {
    message: 'Password is too repetitive',
  });

/** Calendar date of birth, YYYY-MM-DD. Eligibility is enforced separately on the server. */
export const dateOfBirthSchema = z
  .string()
  .refine((value) => parseIsoDate(value) !== null, { message: 'Enter a valid date (YYYY-MM-DD)' });

export const termsAcceptanceSchema = z.object({
  acceptedTerms: z.literal(true, { error: 'You must accept the terms and privacy policy' }),
  termsVersion: z.string().min(1).max(64).default(CURRENT_TERMS_VERSION),
});

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    dateOfBirth: dateOfBirthSchema,
  })
  .and(termsAcceptanceSchema)
  .refine(
    (value) => {
      const localPart = value.email.split('@')[0] ?? '';
      // Very short local parts would match almost any password, so only check meaningful ones.
      return localPart.length < 4 || !value.password.toLowerCase().includes(localPart);
    },
    {
      message: 'Password must not contain your email name',
      path: ['password'],
    },
  );
export type RegisterRequest = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately no strength rules here: never reveal the password policy to a login attempt.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.input<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});
export type RefreshRequest = z.input<typeof refreshSchema>;

export const logoutSchema = refreshSchema;
export type LogoutRequest = z.input<typeof logoutSchema>;

export const oneTimeTokenSchema = z.string().min(20).max(512);

export const verifyEmailSchema = z.object({ token: oneTimeTokenSchema });
export type VerifyEmailRequest = z.input<typeof verifyEmailSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.input<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: oneTimeTokenSchema,
  newPassword: passwordSchema,
});
export type ResetPasswordRequest = z.input<typeof resetPasswordSchema>;

export const socialLoginSchema = z.object({
  provider: z.enum(SOCIAL_PROVIDERS),
  /** Google ID token or Apple identity token obtained by the mobile SDK. */
  idToken: z.string().min(20).max(8192),
  /** Raw nonce the client generated; compared (raw or SHA-256 hex) against the token's nonce claim. */
  nonce: z.string().min(8).max(256).optional(),
  /** Required only the first time an identity is seen (account creation). */
  dateOfBirth: dateOfBirthSchema.optional(),
  acceptedTerms: z.literal(true).optional(),
  termsVersion: z.string().min(1).max(64).optional(),
});
export type SocialLoginRequest = z.input<typeof socialLoginSchema>;

/** Safe, non-sensitive view of the signed-in account. Never includes DOB, hashes or tokens. */
export interface AccountView {
  id: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export interface AuthSession {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  refreshToken: string;
  user: AccountView;
}

export interface MessageResponse {
  message: string;
}
