import { Link } from 'expo-router';
import { useState } from 'react';
import { theme } from '@gameverse/design-system';
import { accountApi } from '../../src/api-client';
import { Body, Button, ErrorText, Screen, TextField, Title, useAction } from '../../src/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  return (
    <Screen style={{ justifyContent: 'center' }}>
      <Title>Forgot password</Title>
      <Body muted>Enter your email and we will send a link to choose a new password.</Body>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        style={{ marginTop: theme.spacing.lg }}
      />
      <ErrorText error={error} />
      {message ? <Body>{message}</Body> : null}
      <Button
        label="Send reset link"
        busy={busy}
        disabled={email.trim() === ''}
        onPress={() =>
          void run(async () => {
            const result = await accountApi.forgotPassword(email.trim());
            setMessage(result.message);
          })
        }
      />
      <Link
        href="/(auth)/sign-in"
        style={{ color: theme.colors.accentBlue, marginTop: theme.spacing.md, fontSize: 16 }}
      >
        Back to sign in
      </Link>
    </Screen>
  );
}
