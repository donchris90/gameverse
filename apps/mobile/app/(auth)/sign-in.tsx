import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSession } from '../../src/session';
import { Body, Button, ErrorText, Screen, TextField, Title, useAction } from '../../src/ui';
import { theme } from '@gameverse/design-system';

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <Screen style={{ justifyContent: 'center' }}>
          <Title>GameVerse</Title>
          <Body muted>Sign in to play with friends.</Body>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            style={{ marginTop: theme.spacing.lg }}
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
          />
          <ErrorText error={error} />
          <Button
            label="Sign in"
            busy={busy}
            disabled={email.trim() === '' || password === ''}
            onPress={() => void run(() => signIn(email.trim(), password))}
          />
          <Link
            href="/(auth)/register"
            style={{ color: theme.colors.accentBlue, marginTop: theme.spacing.md, fontSize: 16 }}
          >
            New here? Create an account
          </Link>
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
