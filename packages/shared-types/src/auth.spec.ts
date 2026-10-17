import { describe, expect, it } from 'vitest';
import { CURRENT_TERMS_VERSION } from './constants.js';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  socialLoginSchema,
} from './auth.js';

const validRegister = {
  email: '  Player.One@Example.COM ',
  password: 'correct-horse-battery',
  dateOfBirth: '2000-05-20',
  acceptedTerms: true,
};

describe('registerSchema', () => {
  it('normalises email and fills the current terms version', () => {
    const parsed = registerSchema.parse(validRegister);
    expect(parsed.email).toBe('player.one@example.com');
    expect(parsed.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it('requires explicit terms acceptance', () => {
    expect(registerSchema.safeParse({ ...validRegister, acceptedTerms: false }).success).toBe(
      false,
    );
    const { acceptedTerms: _omitted, ...withoutTerms } = validRegister;
    expect(registerSchema.safeParse(withoutTerms).success).toBe(false);
  });

  it('rejects short, repetitive and email-derived passwords', () => {
    expect(registerSchema.safeParse({ ...validRegister, password: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...validRegister, password: 'aaaaaaaaaaaa' }).success).toBe(
      false,
    );
    expect(
      registerSchema.safeParse({ ...validRegister, password: 'xx-player.one-xx' }).success,
    ).toBe(false);
  });

  it('does not reject passwords for very short email local parts', () => {
    const result = registerSchema.safeParse({
      ...validRegister,
      email: 'a@example.com',
      password: 'a-perfectly-good-passphrase',
    });
    expect(result.success).toBe(true);
  });

  it('rejects malformed email and impossible dates', () => {
    expect(registerSchema.safeParse({ ...validRegister, email: 'not-an-email' }).success).toBe(
      false,
    );
    expect(registerSchema.safeParse({ ...validRegister, dateOfBirth: '2001-02-30' }).success).toBe(
      false,
    );
  });
});

describe('loginSchema', () => {
  it('does not enforce the password policy on login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});

describe('forgot/reset schemas', () => {
  it('normalises the forgot-password email', () => {
    expect(forgotPasswordSchema.parse({ email: ' A@B.CO ' }).email).toBe('a@b.co');
  });

  it('applies the password policy to the new password', () => {
    const token = 'x'.repeat(30);
    expect(resetPasswordSchema.safeParse({ token, newPassword: 'short' }).success).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token, newPassword: 'a-long-new-passphrase' }).success,
    ).toBe(true);
  });
});

describe('socialLoginSchema', () => {
  it('only allows google and apple', () => {
    const base = { idToken: 'x'.repeat(40) };
    expect(socialLoginSchema.safeParse({ ...base, provider: 'google' }).success).toBe(true);
    expect(socialLoginSchema.safeParse({ ...base, provider: 'apple' }).success).toBe(true);
    expect(socialLoginSchema.safeParse({ ...base, provider: 'facebook' }).success).toBe(false);
  });
});
