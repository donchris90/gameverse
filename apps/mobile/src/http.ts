import * as SecureStore from 'expo-secure-store';
import type { AuthSession } from '@gameverse/shared-types';

export const API_URL = (process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
const REFRESH_KEY = 'gv.refreshToken';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface Tokens {
  accessToken: string;
  /** Epoch ms when the access token stops being valid. */
  expiresAt: number;
}

let tokens: Tokens | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

/** A valid access token for a socket handshake: refreshes first when the current one is nearly expired. */
export async function freshAccessToken(): Promise<string | null> {
  if (tokens && tokens.expiresAt - Date.now() > 30_000) return tokens.accessToken;
  if (!(await refreshSession())) return null;
  return tokens?.accessToken ?? null;
}

export const getAccessToken = (): string | null => tokens?.accessToken ?? null;
export const setSignedOutHandler = (handler: (() => void) | null): void => {
  onSignedOut = handler;
};

export async function readStoredRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    return null;
  }
}

async function storeRefreshToken(token: string | null): Promise<void> {
  try {
    if (token) await SecureStore.setItemAsync(REFRESH_KEY, token);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch {
    // Secure storage unavailable: the session just won't survive an app restart.
  }
}

/** Keeps the new token pair; the refresh token goes to the OS keychain, the access token stays in memory. */
export async function adoptSession(auth: AuthSession): Promise<void> {
  tokens = { accessToken: auth.accessToken, expiresAt: Date.now() + auth.expiresIn * 1000 };
  await storeRefreshToken(auth.refreshToken);
}

export async function clearSession(): Promise<void> {
  tokens = null;
  await storeRefreshToken(null);
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = `Request failed (${String(response.status)})`;
  let details: unknown;
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
    details = body.error?.details;
  } catch {
    // Not JSON (proxy error page, etc.): keep the generic text.
  }
  return new ApiError(response.status, code, message, details);
}

/** Exchanges the stored refresh token. Concurrent callers share one request (tokens rotate). */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const refreshToken = await readStoredRefreshToken();
    if (!refreshToken) return false;
    let response: Response;
    try {
      response = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Offline: do not sign the user out because the network is down.
      throw new ApiError(0, 'NETWORK', 'Cannot reach the server');
    }
    if (!response.ok) return false;
    await adoptSession((await response.json()) as AuthSession);
    return true;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; auth?: boolean; retry?: boolean } = {},
): Promise<T> {
  const auth = options.auth ?? true;
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && tokens) headers['Authorization'] = `Bearer ${tokens.accessToken}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }

  if (response.status === 401 && auth && (options.retry ?? true)) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(method, path, { ...options, retry: false });
    await clearSession();
    onSignedOut?.();
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
