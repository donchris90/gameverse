// Phase 0 voice spike helpers. Credentials live in memory only and are never persisted.
const baseUrl = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export interface SpikeGrant {
  appId: string;
  channel: string;
  uid: number;
  token: string;
  expiresAt: string;
}

async function post<T>(path: string, body: unknown, accessToken?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} failed with HTTP ${String(response.status)}`);
  return (await response.json()) as T;
}

export async function signIn(email: string, password: string): Promise<string> {
  const session = await post<{ accessToken: string }>('/v1/auth/login', { email, password });
  return session.accessToken;
}

export function fetchSpikeGrant(accessToken: string, channel: string): Promise<SpikeGrant> {
  return post<SpikeGrant>('/v1/voice/spike/token', { channel }, accessToken);
}
