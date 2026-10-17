import { theme } from '@gameverse/design-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { chat, games, social } from '../../src/api-client';
import { ReportPanel } from '../../src/ReportPanel';
import {
  Avatar,
  Body,
  Button,
  ErrorText,
  Loading,
  Screen,
  Title,
  useAction,
  useLoad,
} from '../../src/ui';

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const load = useCallback(() => social.profile(id), [id]);
  const { data: profile, error, loading, reload } = useLoad(load);
  const action = useAction();
  const [reporting, setReporting] = useState(false);

  if (loading && !profile) return <Loading />;
  if (!profile) {
    return (
      <Screen>
        <Title>Player not found</Title>
        <Body muted>This player does not exist or is not available to you.</Body>
        <ErrorText error={error} />
        <Button label="Go back" tone="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const act = (fn: () => Promise<unknown>) =>
    void action.run(async () => {
      await fn();
      await reload();
    });

  const findRequest = async (direction: 'incoming' | 'outgoing') => {
    const page = await social.requests(direction);
    const found = page.items.find((request) => request.user.userId === profile.userId);
    if (!found) throw new Error('This request is no longer pending');
    return found.id;
  };

  const message = () =>
    void action.run(async () => {
      const conversation = await chat.open(profile.userId);
      router.push({
        pathname: '/chat/[id]',
        params: { id: conversation.id, name: profile.username, userId: profile.userId },
      });
    });

  const invite = () =>
    void action.run(async () => {
      await games.invite(profile.userId, 'tictactoe');
      Alert.alert('Invite sent', `${profile.username} can accept it from the Play tab.`);
    });

  const confirm = (title: string, text: string, confirmLabel: string, onConfirm: () => void) =>
    Alert.alert(title, text, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: onConfirm },
    ]);

  return (
    <ScrollView style={{ backgroundColor: theme.colors.background }}>
      <Screen>
        <View style={{ alignItems: 'center', marginVertical: theme.spacing.lg }}>
          <Avatar avatarId={profile.avatarId} name={profile.username} size={96} />
          <Title>{profile.username}</Title>
          {profile.restricted ? (
            <Body muted>This player keeps their profile private.</Body>
          ) : profile.bio ? (
            <Body>{profile.bio}</Body>
          ) : null}
        </View>

        <ErrorText error={action.error} />

        {reporting ? (
          <ReportPanel
            userId={profile.userId}
            username={profile.username}
            onClose={() => setReporting(false)}
          />
        ) : (
          <>
            {profile.relationship === 'NONE' && (
              <Button
                label="Add friend"
                busy={action.busy}
                onPress={() => act(() => social.sendRequest(profile.userId))}
              />
            )}
            {profile.relationship === 'REQUEST_SENT' && (
              <Button
                label="Cancel friend request"
                tone="secondary"
                busy={action.busy}
                onPress={() => act(async () => social.cancel(await findRequest('outgoing')))}
              />
            )}
            {profile.relationship === 'REQUEST_RECEIVED' && (
              <>
                <Button
                  label="Accept friend request"
                  busy={action.busy}
                  onPress={() => act(async () => social.accept(await findRequest('incoming')))}
                />
                <Button
                  label="Decline"
                  tone="secondary"
                  busy={action.busy}
                  onPress={() => act(async () => social.reject(await findRequest('incoming')))}
                />
              </>
            )}
            <Button
              label="Message"
              tone={profile.relationship === 'FRIEND' ? 'primary' : 'secondary'}
              busy={action.busy}
              onPress={message}
            />
            {profile.relationship === 'FRIEND' && (
              <Button label="Invite to play" busy={action.busy} onPress={invite} />
            )}
            {profile.relationship === 'FRIEND' && (
              <Button
                label="Remove friend"
                tone="secondary"
                onPress={() =>
                  confirm(
                    'Remove friend?',
                    `${profile.username} will no longer be your friend.`,
                    'Remove',
                    () => act(() => social.removeFriend(profile.userId)),
                  )
                }
              />
            )}
            <Button label="Report" tone="secondary" onPress={() => setReporting(true)} />
            <Button
              label="Block"
              tone="danger"
              onPress={() =>
                confirm(
                  `Block ${profile.username}?`,
                  'They will not be able to message you or find you, and you will be removed as friends. You can unblock them in Settings.',
                  'Block',
                  () =>
                    void action.run(async () => {
                      await social.block(profile.userId);
                      router.back();
                    }),
                )
              }
            />
          </>
        )}
      </Screen>
    </ScrollView>
  );
}
