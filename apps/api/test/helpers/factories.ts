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

export interface SocialUser extends RegisteredUser {
  id: string;
  username: string;
  token: string;
  auth: { Authorization: string };
}

let usernameCounter = 0;
/** Registers an account and completes onboarding so it can use friends, chat and search. */
export async function registerWithProfile(
  t: TestApp,
  username?: string,
  overrides: Partial<{ avatarId: string; bio: string }> = {},
): Promise<SocialUser> {
  usernameCounter += 1;
  const name = username ?? `Player${String(usernameCounter)}x${Date.now().toString(36).slice(-4)}`;
  const user = await registerUser(t);
  const token = user.session.accessToken;
  await request(t.server)
    .put('/v1/me/profile')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      username: name,
      avatarId: overrides.avatarId ?? 'avatar-01',
      ...(overrides.bio ? { bio: overrides.bio } : {}),
    })
    .expect(200);
  return {
    ...user,
    id: user.session.user.id,
    username: name,
    token,
    auth: { Authorization: `Bearer ${token}` },
  };
}

/** Makes two onboarded users friends through the real API. */
export async function befriend(t: TestApp, a: SocialUser, b: SocialUser): Promise<void> {
  await request(t.server)
    .post('/v1/friends/requests')
    .set(a.auth)
    .send({ userId: b.id })
    .expect(200);
  const incoming = await request(t.server)
    .get('/v1/friends/requests?direction=incoming')
    .set(b.auth)
    .expect(200);
  const id = (incoming.body.items as { id: string }[])[0]?.id;
  await request(t.server)
    .post(`/v1/friends/requests/${String(id)}/accept`)
    .set(b.auth)
    .expect(204);
}

/** Opens (or fetches) the conversation between two users and returns its id. */
export async function openConversation(
  t: TestApp,
  from: SocialUser,
  to: SocialUser,
): Promise<string> {
  const response = await request(t.server)
    .post('/v1/conversations')
    .set(from.auth)
    .send({ userId: to.id })
    .expect(200);
  return (response.body as { id: string }).id;
}

export function newClientMessageId(): string {
  return crypto.randomUUID();
}
