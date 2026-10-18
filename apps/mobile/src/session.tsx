import type { AuthSession, ProfileView } from '@gameverse/shared-types';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { accountApi, me } from './api-client';
import {
  ApiError,
  adoptSession,
  clearSession,
  readStoredRefreshToken,
  refreshSession,
  request,
  setSignedOutHandler,
} from './http';
import { unregisterPush } from './push';
import { setReportedUser } from './observability';
import { realtime } from './realtime';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'needs-profile'; user: AuthSession['user'] }
  | { status: 'ready'; user: AuthSession['user']; profile: ProfileView };

interface SessionApi {
  state: SessionState;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    dateOfBirth: string;
    termsVersion?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  profileSaved: (profile: ProfileView) => void;
  /** Clears local state after the server has already ended the session (deleted account, etc.). */
  localSignOut: () => Promise<void>;
  /** Re-reads the account (for example after the email was verified). */
  reloadAccount: () => Promise<void>;
}

const SessionContext = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function useReadySession(): Extract<SessionState, { status: 'ready' }> {
  const { state } = useSession();
  if (state.status !== 'ready')
    throw new Error('This screen needs a signed-in user with a profile');
  return state;
}

async function loadProfile(user: AuthSession['user']): Promise<SessionState> {
  try {
    const profile = await me.profile();
    return { status: 'ready', user, profile };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { status: 'needs-profile', user };
    throw error;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const reportedId =
    state.status === 'ready' || state.status === 'needs-profile' ? state.user.id : null;
  useEffect(() => setReportedUser(reportedId), [reportedId]);

  const localSignOut = useCallback(async () => {
    realtime.disconnect();
    await clearSession();
    setState({ status: 'signed-out' });
  }, []);

  const begin = useCallback(async (auth: AuthSession) => {
    await adoptSession(auth);
    setState(await loadProfile(auth.user));
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => {
      realtime.disconnect();
      setState({ status: 'signed-out' });
    });
    return () => setSignedOutHandler(null);
  }, []);

  // Restore a previous session on app start.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!(await readStoredRefreshToken())) return setState({ status: 'signed-out' });
        if (!(await refreshSession())) return setState({ status: 'signed-out' });
        const account = await request<AuthSession['user']>('GET', '/v1/me');
        const next = await loadProfile(account);
        if (!cancelled) setState(next);
      } catch {
        // Offline at launch or the server is down: show the sign-in screen rather than hang.
        if (!cancelled) setState({ status: 'signed-out' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The server closes our socket with 4403 when the account is banned, suspended or deleted.
  useEffect(() => {
    realtime.setFatalHandler(() => {
      void localSignOut();
    });
    return () => realtime.setFatalHandler(null);
  }, [localSignOut]);

  // Live connection exists exactly while a profile-complete user is signed in.
  useEffect(() => {
    if (state.status === 'ready') realtime.connect();
    else realtime.disconnect();
  }, [state.status]);

  const api = useMemo<SessionApi>(
    () => ({
      state,
      signIn: async (email, password) => {
        const auth = await request<AuthSession>('POST', '/v1/auth/login', {
          body: { email, password },
          auth: false,
        });
        await begin(auth);
      },
      register: async ({ email, password, dateOfBirth, termsVersion }) => {
        const auth = await request<AuthSession>('POST', '/v1/auth/register', {
          body: {
            email,
            password,
            dateOfBirth,
            acceptedTerms: true,
            ...(termsVersion ? { termsVersion } : {}),
          },
          auth: false,
        });
        await begin(auth);
      },
      signOut: async () => {
        const refreshToken = await readStoredRefreshToken();
        await unregisterPush().catch(() => undefined);
        if (refreshToken) {
          await request<void>('POST', '/v1/auth/logout', {
            body: { refreshToken },
            auth: false,
          }).catch(() => undefined);
        }
        await localSignOut();
      },
      profileSaved: (profile) =>
        setState((current) =>
          current.status === 'signed-out' || current.status === 'loading'
            ? current
            : { status: 'ready', user: current.user, profile },
        ),
      localSignOut,
      reloadAccount: async () => {
        const user = await accountApi.account();
        setState((current) =>
          current.status === 'ready' || current.status === 'needs-profile'
            ? { ...current, user }
            : current,
        );
      },
    }),
    [state, begin, localSignOut],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}
