import { createHash } from 'node:crypto';
import type { AuthSession } from '@gameverse/shared-types';
import request from 'supertest';
import type { TestApp } from './test-app.js';

export const DEFAULT_PASSWORD = 'correct-horse-battery-staple';

let counter = 0;
export function uniqueEmail(prefix = 'player'): string {
  counter += 1;
  return `${prefix}${counter}-${Date.now().toString(36)}@example.test`;
}

/** A date of birth for someone who is `years` old today, shifted by `dayOffset` days. */
export function dateOfBirthForAge(years: number, dayOffset = 0): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface RegisteredUser {
  email: string;
  password: string;
  session: AuthSession;
}

export async function registerUser(
  t: TestApp,
  overrides: Partial<{ email: string; password: string; dateOfBirth: string }> = {},
): Promise<RegisteredUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? DEFAULT_PASSWORD;
  const response = await request(t.server)
    .post('/v1/auth/register')
    .send({
      email,
      password,
      dateOfBirth: overrides.dateOfBirth ?? dateOfBirthForAge(25),
      acceptedTerms: true,
    })
    .expect(201);
  return { email, password, session: response.body as AuthSession };
}

export async function login(t: TestApp, email: string, password: string): Promise<AuthSession> {
  const response = await request(t.server)
    .post('/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body as AuthSession;
}

/** Pulls the one-time token out of the link in the most recent email sent to `to`. */
export function tokenFromLastEmail(t: TestApp, to: string): string {
  const message = t.email.last(to);
  if (!message) throw new Error(`No email was sent to ${to}`);
  const match = /[?&]token=([^\s&]+)/.exec(message.text);
  if (!match?.[1]) throw new Error('No token link found in the email');
  return decodeURIComponent(match[1]);
}

export function bearer(session: AuthSession): { Authorization: string } {
  return { Authorization: `Bearer ${session.accessToken}` };
}
