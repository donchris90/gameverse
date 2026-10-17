import type { FriendRequestView, UserCard } from '@gameverse/shared-types';
import { USER_SEARCH_MIN_LENGTH } from '@gameverse/shared-types';
import { theme } from '@gameverse/design-system';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { social } from '../../src/api-client';
import { usePresence } from '../../src/presence';
import {
  Avatar,
  Body,
  Button,
  Empty,
  ErrorText,
  Loading,
  Screen,
  TextField,
  useAction,
  useLoad,
} from '../../src/ui';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: theme.spacing.lg }}>
      <Text
        accessibilityRole="header"
        style={{ color: theme.colors.textSecondary, fontSize: 14, marginBottom: theme.spacing.sm }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function PersonRow(props: {
  user: UserCard;
  online?: boolean;
  onPress: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, gap: theme.spacing.md }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${props.user.username}'s profile`}
        onPress={props.onPress}
        style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: theme.spacing.md }}
      >
        <Avatar
          avatarId={props.user.avatarId}
          name={props.user.username}
          online={props.online ?? null}
        />
        <Text style={{ color: theme.colors.textPrimary, fontSize: 16, flexShrink: 1 }}>
          {props.user.username}
        </Text>
      </Pressable>
      {props.actions}
    </View>
  );
}

export default function Friends() {
  const router = useRouter();
  const loadFriends = useCallback(() => social.friends(), []);
  const loadIncoming = useCallback(() => social.requests('incoming'), []);
  const loadOutgoing = useCallback(() => social.requests('outgoing'), []);
  const friends = useLoad(loadFriends);
  const incoming = useLoad(loadIncoming);
  const outgoing = useLoad(loadOutgoing);
  const action = useAction();
  const online = usePresence((friends.data?.items ?? []).map((friend) => friend.userId));

  const [text, setText] = useState('');
  const [results, setResults] = useState<UserCard[] | null>(null);
  const search = useAction();

  // Come back to fresh data after visiting a profile (accept, block, unfriend there).
  const { reload: reloadFriends } = friends;
  const { reload: reloadIncoming } = incoming;
  const { reload: reloadOutgoing } = outgoing;
  useFocusEffect(
    useCallback(() => {
      void reloadFriends();
      void reloadIncoming();
      void reloadOutgoing();
    }, [reloadFriends, reloadIncoming, reloadOutgoing]),
  );

  useEffect(() => {
    const query = text.trim();
    if (query.length < USER_SEARCH_MIN_LENGTH) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void search
        .run(() => social.search(query))
        .then((found) => {
          if (!cancelled && found) setResults(found);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `search.run` is stable
  }, [text]);

  const refreshAll = async () => {
    await Promise.all([reloadFriends(), reloadIncoming(), reloadOutgoing()]);
  };
  const act = (fn: () => Promise<unknown>) =>
    void action.run(async () => {
      await fn();
      await refreshAll();
    });

  const open = (userId: string) => router.push({ pathname: '/user/[id]', params: { id: userId } });
  const requests = incoming.data?.items ?? [];
  const sent = outgoing.data?.items ?? [];

  const requestRow = (request: FriendRequestView, mine: boolean) => (
    <PersonRow
      key={request.id}
      user={request.user}
      onPress={() => open(request.user.userId)}
      actions={
        mine ? (
          <Button
            label="Cancel"
            tone="secondary"
            onPress={() => act(() => social.cancel(request.id))}
          />
        ) : (
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Button label="Accept" onPress={() => act(() => social.accept(request.id))} />
            <Button
              label="Decline"
              tone="secondary"
              onPress={() => act(() => social.reject(request.id))}
            />
          </View>
        )
      }
    />
  );

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: theme.colors.background }}
    >
      <Screen>
        <TextField
          label="Find players by username"
          value={text}
          onChangeText={setText}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Search"
        />
        <ErrorText error={search.error ?? action.error} />
        {results && (
          <Section title="Search results">
            {results.length === 0 ? (
              <Empty text="No players found." />
            ) : (
              results.map((user) => (
                <PersonRow
                  key={user.userId}
                  user={user}
                  onPress={() => open(user.userId)}
                  actions={
                    user.relationship === 'NONE' ? (
                      <Button
                        label="Add"
                        onPress={() =>
                          act(async () => {
                            await social.sendRequest(user.userId);
                            setResults(await social.search(text.trim()));
                          })
                        }
                      />
                    ) : (
                      <Body muted>
                        {user.relationship === 'FRIEND'
                          ? 'Friends'
                          : user.relationship === 'REQUEST_SENT'
                            ? 'Requested'
                            : 'Wants to be friends'}
                      </Body>
                    )
                  }
                />
              ))
            )}
          </Section>
        )}

        {requests.length > 0 && (
          <Section title="Friend requests">{requests.map((r) => requestRow(r, false))}</Section>
        )}

        <Section title={`Friends${friends.data ? ` (${String(friends.data.items.length)})` : ''}`}>
          {friends.loading && !friends.data ? (
            <Loading />
          ) : friends.error && !friends.data ? (
            <ErrorText error={friends.error} />
          ) : friends.data?.items.length === 0 ? (
            <Empty text="No friends yet. Search for a username above to add someone." />
          ) : (
            friends.data?.items.map((user) => (
              <PersonRow
                key={user.userId}
                user={user}
                online={online[user.userId] === true}
                onPress={() => open(user.userId)}
              />
            ))
          )}
        </Section>

        {sent.length > 0 && (
          <Section title="Sent requests">{sent.map((r) => requestRow(r, true))}</Section>
        )}
      </Screen>
    </ScrollView>
  );
}
