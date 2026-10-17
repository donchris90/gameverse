import { AVATAR_IDS, BIO_MAX_LENGTH, USERNAME_PATTERN } from '@gameverse/shared-types';
import type { UsernameCheckResult } from '@gameverse/shared-types';
import { theme } from '@gameverse/design-system';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { me } from '../src/api-client';
import { useSession } from '../src/session';
import { Avatar, Body, Button, ErrorText, Screen, TextField, Title, useAction } from '../src/ui';

const REASONS: Record<string, string> = {
  INVALID: 'Use 3-20 letters, digits or underscores, starting with a letter',
  TAKEN: 'That username is taken',
  NOT_ALLOWED: 'That username is not allowed',
};

export default function Onboarding() {
  const { profileSaved, signOut } = useSession();
  const [username, setUsername] = useState('');
  const [avatarId, setAvatarId] = useState<string>(AVATAR_IDS[0]);
  const [bio, setBio] = useState('');
  const [check, setCheck] = useState<UsernameCheckResult | null>(null);
  const { busy, error, run } = useAction();

  // Debounced availability check; the server re-checks on save, this is only early feedback.
  useEffect(() => {
    setCheck(null);
    if (!USERNAME_PATTERN.test(username)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      me.checkUsername(username)
        .then((result) => {
          if (!cancelled) setCheck(result);
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  const usernameError =
    username !== '' && !USERNAME_PATTERN.test(username)
      ? REASONS['INVALID']
      : check && !check.available
        ? (REASONS[check.reason ?? 'NOT_ALLOWED'] ?? REASONS['NOT_ALLOWED'])
        : null;
  const canSave = USERNAME_PATTERN.test(username) && check?.available === true;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <Screen>
          <Title>Pick a username</Title>
          <Body muted>
            Other players find you by this name. You can change it once every 7 days.
          </Body>
          <View style={{ height: theme.spacing.lg }} />
          <TextField
            label="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            error={usernameError}
          />
          <Body muted>Choose an avatar</Body>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: theme.spacing.md }}
          >
            {AVATAR_IDS.map((id) => (
              <Pressable
                key={id}
                accessibilityRole="radio"
                accessibilityState={{ selected: id === avatarId }}
                accessibilityLabel={`Avatar ${id.replace('avatar-', '')}`}
                onPress={() => setAvatarId(id)}
                style={{
                  margin: theme.spacing.xs,
                  padding: 3,
                  borderRadius: 30,
                  borderWidth: 2,
                  borderColor: id === avatarId ? theme.colors.primary : 'transparent',
                }}
              >
                <Avatar avatarId={id} name={username || '?'} size={48} />
              </Pressable>
            ))}
          </View>
          <TextField
            label={`Bio (optional, up to ${String(BIO_MAX_LENGTH)} characters)`}
            value={bio}
            onChangeText={setBio}
            maxLength={BIO_MAX_LENGTH}
            multiline
          />
          <ErrorText error={error} />
          <Button
            label="Continue"
            busy={busy}
            disabled={!canSave}
            onPress={() =>
              void run(async () => {
                const profile = await me.saveProfile(username, avatarId, bio.trim() || null);
                profileSaved(profile);
              })
            }
          />
          <Button label="Sign out" tone="secondary" onPress={() => void signOut()} />
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
