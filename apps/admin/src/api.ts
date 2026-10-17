import type {
  AdminUserDetail,
  AdminUserSummary,
  AuditLogView,
  AuthSession,
  Page,
  ReportStatus,
  ReportView,
  UserRole,
} from '@gameverse/shared-types';

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const REFRESH_KEY = 'gv-admin-refresh';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Session {
  accessToken: string;
  user: AuthSession['user'];
}

let session: Session | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export const getSession = (): Session | null => session;
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function setSession(next: Session | null): void {
  session = next;
  for (const listener of listeners) listener();
}

function readRefreshToken(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}
function writeRefreshToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(REFRESH_KEY, token);
    else sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    // Storage can be blocked; the admin simply has to sign in again after a reload.
  }
}

async function raw(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, init);
}

async function toError(response: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = `Request failed (${String(response.status)})`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  return new ApiError(response.status, code, message);
}

function acceptSession(auth: AuthSession): void {
  writeRefreshToken(auth.refreshToken);
  setSession({ accessToken: auth.accessToken, user: auth.user });
}

async function refresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const refreshToken = readRefreshToken();
    if (!refreshToken) return false;
    const response = await raw('/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;
    acceptSession((await response.json()) as AuthSession);
    return true;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function signIn(email: string, password: string): Promise<void> {
  const response = await raw('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw await toError(response);
  const auth = (await response.json()) as AuthSession;
  if (auth.user.role !== 'MODERATOR' && auth.user.role !== 'ADMIN') {
    // Never keep a normal player's session in the admin tool.
    await raw('/v1/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    }).catch(() => undefined);
    throw new ApiError(403, 'NOT_STAFF', 'This account does not have access to the admin tools');
  }
  acceptSession(auth);
}

/** Restores a session after a page reload, if the refresh token is still good. */
export async function restore(): Promise<void> {
  if (!(await refresh().catch(() => false))) writeRefreshToken(null);
}

export async function signOut(): Promise<void> {
  const refreshToken = readRefreshToken();
  writeRefreshToken(null);
  setSession(null);
  if (refreshToken) {
    await raw('/v1/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
}

async function call<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (session) headers['Authorization'] = `Bearer ${session.accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await raw(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 401 && retry && (await refresh().catch(() => false))) {
    return call<T>(method, path, body, false);
  }
  if (response.status === 401) {
    writeRefreshToken(null);
    setSession(null);
  }
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  reports: (status: ReportStatus, cursor?: string) =>
    call<Page<ReportView>>('GET', `/v1/admin/reports${query({ status, cursor })}`),
  report: (id: string) => call<ReportView>('GET', `/v1/admin/reports/${id}`),
  dismissReport: (id: string, note: string) =>
    call<void>('POST', `/v1/admin/reports/${id}/dismiss`, { note }),
  searchUsers: (q: string) => call<AdminUserSummary[]>('GET', `/v1/admin/users${query({ q })}`),
  user: (id: string) => call<AdminUserDetail>('GET', `/v1/admin/users/${id}`),
  act: (id: string, action: 'ban' | 'suspend' | 'reinstate', reason: string, reportId?: string) =>
    call<void>('POST', `/v1/admin/users/${id}/${action}`, {
      reason,
      ...(reportId ? { reportId } : {}),
    }),
  changeRole: (id: string, role: UserRole, reason: string) =>
    call<void>('PATCH', `/v1/admin/users/${id}/role`, { role, reason }),
  audit: (cursor?: string, targetId?: string) =>
    call<Page<AuditLogView>>('GET', `/v1/admin/audit-logs${query({ cursor, targetId })}`),
};
