import { MIN_AGE_YEARS, PASSWORD_MIN_LENGTH, checkAgeEligibility } from '@gameverse/shared-types';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { theme } from '@gameverse/design-system';
import { ApiError } from '../../src/http';
import { LegalLinks } from '../../src/LegalLinks';
import { useSession } from '../../src/session';
import { Body, Button, ErrorText, Screen, TextField, Title, useAction } from '../../src/ui';

export default function Register() {
  const { register } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dob, setDob] = useState('');
  const [accepted, setAccepted] = useState(false);
  const { busy, error, run } = useAction();

  const dobCheck = /^\d{4}-\d{2}-\d{2}$/.test(dob) ? checkAgeEligibility(dob) : null;
  const dobError =
    dobCheck && !dobCheck.ok
      ? dobCheck.reason === 'too_young'
        ? `You must be at least ${String(MIN_AGE_YEARS)} years old to use GameVerse`
        : 'Enter a valid date of birth'
      : null;
  const passwordError =
    password !== '' && password.length < PASSWORD_MIN_LENGTH
      ? `Use at least ${String(PASSWORD_MIN_LENGTH)} characters`
      : null;
  const canSubmit =
    email.trim() !== '' &&
    password.length >= PASSWORD_MIN_LENGTH &&
    dobCheck?.ok === true &&
    accepted;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <Screen style={{ justifyContent: 'center' }}>
          <Title>Create account</Title>
          <Body muted>GameVerse is for players aged {MIN_AGE_YEARS} and over.</Body>
          <View style={{ height: theme.spacing.lg }} />
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
          />
          <TextField
            label={`Password (at least ${String(PASSWORD_MIN_LENGTH)} characters)`}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={passwordError}
          />
          <TextField
            label="Date of birth (YYYY-MM-DD)"
            value={dob}
            onChangeText={setDob}
            keyboardType="numbers-and-punctuation"
            placeholder="2000-01-31"
            maxLength={10}
            error={dobError}
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
            accessibilityLabel="I accept the Terms and Privacy Policy"
            onPress={() => setAccepted(!accepted)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 44,
              marginBottom: theme.spacing.md,
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: theme.colors.borderStrong,
                backgroundColor: accepted ? theme.colors.primary : 'transparent',
                marginRight: theme.spacing.md,
              }}
            />
            <Text style={{ color: theme.colors.textPrimary, flex: 1 }}>
              I accept the Terms and Privacy Policy
            </Text>
          </Pressable>
          <LegalLinks only={['Privacy policy', 'Terms of service']} />
          <ErrorText
            error={
              error instanceof ApiError && error.code === 'UNDER_MINIMUM_AGE'
                ? error.message
                : error
            }
          />
          <Button
            label="Create account"
            busy={busy}
            disabled={!canSubmit}
            onPress={() =>
              void run(() => register({ email: email.trim(), password, dateOfBirth: dob }))
            }
          />
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
