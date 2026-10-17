import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { me } from '../src/api-client';
import { useSession } from '../src/session';
import { Body, Button, ErrorText, Screen, Title, useAction } from '../src/ui';

/** Opened from the link in the confirmation email (gameverse://delete-account?token=...). */
export default function DeleteAccount() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { localSignOut } = useSession();
  const router = useRouter();
  const { busy, error, run } = useAction();

  if (!token) {
    return (
      <Screen>
        <Title>Delete account</Title>
        <Body muted>
          To delete your account, request a confirmation email from Settings, then open the link in
          that email on this phone while signed in.
        </Body>
        <Button
          label="Back to settings"
          tone="secondary"
          onPress={() => router.replace('/(tabs)/settings')}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Delete your account?</Title>
      <Body>
        This permanently deletes your profile, friends, chats and sign-in details. It cannot be
        undone.
      </Body>
      <Body muted>
        Reports about you or made by you and our moderation records are kept, as described in the
        privacy policy.
      </Body>
      <ErrorText error={error} />
      <Button
        label="Delete my account"
        tone="danger"
        busy={busy}
        onPress={() =>
          Alert.alert('Delete account', 'This is permanent.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () =>
                void run(async () => {
                  await me.confirmDeletion(token);
                  await localSignOut();
                }),
            },
          ])
        }
      />
      <Button
        label="Keep my account"
        tone="secondary"
        disabled={busy}
        onPress={() => router.replace('/(tabs)/chats')}
      />
    </Screen>
  );
}
