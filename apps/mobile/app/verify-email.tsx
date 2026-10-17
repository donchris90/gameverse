import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { accountApi } from '../src/api-client';
import { useSession } from '../src/session';
import { Body, Button, ErrorText, Loading, Screen, Title } from '../src/ui';

/** Opened from the link in the verification email (gameverse://verify-email?token=...). */
export default function VerifyEmail() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { state, reloadAccount } = useSession();
  const router = useRouter();
  const [result, setResult] = useState<'working' | 'done' | 'failed'>('working');
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  useEffect(() => {
    // One-time token: guard against the effect running twice so the second call cannot "fail".
    if (started.current) return;
    started.current = true;
    if (!token) {
      setResult('failed');
      return;
    }
    accountApi
      .verifyEmail(token)
      .then(async () => {
        setResult('done');
        if (state.status === 'ready' || state.status === 'needs-profile') {
          await reloadAccount().catch(() => undefined);
        }
      })
      .catch((err: unknown) => {
        setError(err);
        setResult('failed');
      });
  }, [token, state.status, reloadAccount]);

  const signedIn = state.status === 'ready' || state.status === 'needs-profile';
  const goOn = () => router.replace(signedIn ? '/(tabs)/chats' : '/(auth)/sign-in');

  if (result === 'working') return <Loading />;
  return (
    <Screen style={{ justifyContent: 'center' }}>
      <Title>{result === 'done' ? 'Email verified' : 'Could not verify your email'}</Title>
      {result === 'done' ? (
        <Body muted>Thanks. Your email address is now confirmed.</Body>
      ) : (
        <>
          <Body muted>
            The link may have expired or already been used. You can request a new one from Settings.
          </Body>
          <ErrorText error={error} />
        </>
      )}
      <Button label={signedIn ? 'Continue' : 'Go to sign in'} onPress={goOn} />
    </Screen>
  );
}
