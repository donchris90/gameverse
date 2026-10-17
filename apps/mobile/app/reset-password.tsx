import { PASSWORD_MIN_LENGTH } from '@gameverse/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { accountApi } from '../src/api-client';
import { Body, Button, ErrorText, Screen, TextField, Title, useAction } from '../src/ui';

/** Opened from the link in the reset email (gameverse://reset-password?token=...). */
export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();

  if (!token) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <Title>Link not valid</Title>
        <Body muted>
          Open the link from your email again, or request a new one from the sign-in screen.
        </Body>
        <Button label="Go to sign in" onPress={() => router.replace('/(auth)/sign-in')} />
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <Title>Password changed</Title>
        <Body muted>You have been signed out everywhere. Sign in with your new password.</Body>
        <Button label="Go to sign in" onPress={() => router.replace('/(auth)/sign-in')} />
      </Screen>
    );
  }

  const tooShort = password !== '' && password.length < PASSWORD_MIN_LENGTH;
  const mismatch = confirm !== '' && confirm !== password;
  const canSubmit = password.length >= PASSWORD_MIN_LENGTH && confirm === password;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <Screen style={{ justifyContent: 'center' }}>
          <Title>Choose a new password</Title>
          <TextField
            label={`New password (at least ${String(PASSWORD_MIN_LENGTH)} characters)`}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={tooShort ? `Use at least ${String(PASSWORD_MIN_LENGTH)} characters` : null}
          />
          <TextField
            label="Repeat new password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={mismatch ? 'Passwords do not match' : null}
          />
          <ErrorText error={error} />
          <Button
            label="Change password"
            busy={busy}
            disabled={!canSubmit}
            onPress={() =>
              void run(async () => {
                await accountApi.resetPassword(token, password);
                setDone(true);
              })
            }
          />
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
