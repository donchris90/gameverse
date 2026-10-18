import {
  DIRECT_MESSAGE_POLICIES,
  ONLINE_STATUS_VISIBILITIES,
  PROFILE_VISIBILITIES,
  type SettingsView,
} from '@gameverse/shared-types';
import { theme } from '@gameverse/design-system';
import { Link, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { accountApi, me } from '../../src/api-client';
import { LegalLinks } from '../../src/LegalLinks';
import { setReduceMotionChoice, useReduceMotion } from '../../src/ludo/motion';
import { registerForPush, type PushRegistration } from '../../src/push';
import { useReadySession, useSession } from '../../src/session';
import { Avatar, Body, Button, ErrorText, Loading, Screen, useAction, useLoad } from '../../src/ui';

const LABELS: Record<string, string> = {
  EVERYONE: 'Everyone',
  FRIENDS: 'Friends',
  NOBODY: 'Nobody',
  AUTO: 'Follow phone',
  FULL: 'Full',
  REDUCED: 'Reduced',
};

function Choice<T extends string>(props: {
  title: string;
  hint: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
}) {
  return (
    <View style={{ marginBottom: theme.spacing.lg }}>
      <Text
        accessibilityRole="header"
        style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: '600' }}
      >
        {props.title}
      </Text>
      <Text style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.sm }}>
        {props.hint}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {props.options.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={`${props.title}: ${LABELS[option] ?? option}`}
            accessibilityState={{ selected: option === props.value, disabled: props.disabled }}
            disabled={props.disabled}
            onPress={() => props.onChange(option)}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: theme.radii.sm,
              borderWidth: 1,
              borderColor:
                option === props.value ? theme.colors.primary : theme.colors.borderStrong,
              backgroundColor: option === props.value ? theme.colors.primary : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.colors.textPrimary }}>{LABELS[option] ?? option}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function Settings() {
  const { profile, user } = useReadySession();
  const { signOut } = useSession();
  const router = useRouter();
  const motion = useReduceMotion();
  const load = useCallback(() => me.settings(), []);
  const { data: settings, setData, error, loading } = useLoad(load);
  const save = useAction();
  const deletion = useAction();
  const verify = useAction();
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [deletionNote, setDeletionNote] = useState<string | null>(null);
  const [push, setPush] = useState<PushRegistration | null>(null);

  const change = (patch: Partial<SettingsView>) =>
    void save.run(async () => {
      setData(await me.updateSettings(patch));
    });

  return (
    <ScrollView style={{ backgroundColor: theme.colors.background }}>
      <Screen>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            marginBottom: theme.spacing.lg,
          }}
        >
          <Avatar avatarId={profile.avatarId} name={profile.username} size={56} />
          <View>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 20, fontWeight: '700' }}>
              {profile.username}
            </Text>
            <Text style={{ color: theme.colors.textSecondary }}>{user.email}</Text>
          </View>
        </View>

        {!user.emailVerified && (
          <View style={{ marginBottom: theme.spacing.lg }}>
            <Body muted>Your email address is not verified yet.</Body>
            <ErrorText error={verify.error} />
            {verifyNote ? (
              <Body muted>{verifyNote}</Body>
            ) : (
              <Button
                label="Send verification email"
                tone="secondary"
                busy={verify.busy}
                onPress={() =>
                  void verify.run(async () => {
                    const result = await accountApi.resendVerification();
                    setVerifyNote(result.message);
                  })
                }
              />
            )}
          </View>
        )}

        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.textPrimary,
            fontSize: 22,
            fontWeight: '700',
            marginBottom: theme.spacing.md,
          }}
        >
          Privacy
        </Text>
        <ErrorText error={error ?? save.error} />
        {loading && !settings ? (
          <Loading />
        ) : settings ? (
          <>
            <Choice
              title="Who can see my profile"
              hint="Your username and avatar are always visible to people who search for you."
              options={PROFILE_VISIBILITIES}
              value={settings.profileVisibility}
              onChange={(value) => change({ profileVisibility: value })}
              disabled={save.busy}
            />
            <Choice
              title="Who can see when I'm online"
              hint="Applies to the green dot and live status."
              options={ONLINE_STATUS_VISIBILITIES}
              value={settings.onlineStatusVisibility}
              onChange={(value) => change({ onlineStatusVisibility: value })}
              disabled={save.busy}
            />
            <Choice
              title="Game animations"
              hint="Reduced skips token hopping and pulsing in Ludo. Try it if the game feels slow."
              options={['AUTO', 'FULL', 'REDUCED'] as const}
              value={motion.choice === null ? 'AUTO' : motion.choice ? 'REDUCED' : 'FULL'}
              onChange={(value) =>
                void setReduceMotionChoice(value === 'AUTO' ? null : value === 'REDUCED')
              }
              disabled={false}
            />
            <Choice
              title="Who can message me"
              hint="Blocked players can never message you."
              options={DIRECT_MESSAGE_POLICIES}
              value={settings.dmPolicy}
              onChange={(value) => change({ dmPolicy: value })}
              disabled={save.busy}
            />
          </>
        ) : null}

        <Button label="Blocked players" tone="secondary" onPress={() => router.push('/blocked')} />
        <Button
          label={push === 'registered' ? 'Notifications are on' : 'Turn on notifications'}
          tone="secondary"
          disabled={push === 'registered'}
          onPress={() =>
            void registerForPush()
              .then(setPush)
              .catch(() => setPush('unavailable'))
          }
        />
        {push === 'denied' && (
          <Body muted>Notifications are blocked. Enable them in your phone settings.</Body>
        )}
        {push === 'unavailable' && (
          <Body muted>Notifications are not available on this build or device.</Body>
        )}

        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.textPrimary,
            fontSize: 22,
            fontWeight: '700',
            marginVertical: theme.spacing.md,
          }}
        >
          Account
        </Text>
        <LegalLinks />
        <Button label="Sign out" tone="secondary" onPress={() => void signOut()} />
        <ErrorText error={deletion.error} />
        {deletionNote ? (
          <Body muted>{deletionNote}</Body>
        ) : (
          <Button
            label="Delete my account"
            tone="danger"
            busy={deletion.busy}
            onPress={() =>
              void deletion.run(async () => {
                const result = await me.requestDeletion();
                setDeletionNote(result.message);
              })
            }
          />
        )}
        {__DEV__ && (
          <Link
            href="/dev-tools"
            style={{ color: theme.colors.accentBlue, marginTop: theme.spacing.lg, fontSize: 16 }}
          >
            Developer tools
          </Link>
        )}
      </Screen>
    </ScrollView>
  );
}
