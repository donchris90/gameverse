import type { ConversationView } from '@gameverse/shared-types';
import { theme } from '@gameverse/design-system';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { chat } from '../../src/api-client';
import { usePresence } from '../../src/presence';
import { realtime } from '../../src/realtime';
import { Avatar, Empty, ErrorText, Loading, Screen, useLoad } from '../../src/ui';

export default function Chats() {
  const router = useRouter();
  const load = useCallback(() => chat.list(), []);
  const { data, error, loading, reload } = useLoad(load);
  const online = usePresence((data?.items ?? []).map((item) => item.user.userId));

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // A new message (or a read receipt) changes order, preview and unread counts: just refetch.
  useEffect(
    () =>
      realtime.subscribe((event) => {
        if (event.type === 'message.new' || event.type === 'message.read') void reload();
      }),
    [reload],
  );

  const renderItem = ({ item }: { item: ConversationView }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Chat with ${item.user.username}${item.unreadCount > 0 ? `, ${String(item.unreadCount)} unread` : ''}`}
      onPress={() =>
        router.push({
          pathname: '/chat/[id]',
          params: { id: item.id, name: item.user.username, userId: item.user.userId },
        })
      }
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, gap: theme.spacing.md }}
    >
      <Avatar
        avatarId={item.user.avatarId}
        name={item.user.username}
        online={online[item.user.userId] === true}
      />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: 16,
            fontWeight: item.unreadCount > 0 ? '700' : '400',
          }}
        >
          {item.user.username}
        </Text>
        <Text numberOfLines={1} style={{ color: theme.colors.textSecondary }}>
          {item.lastMessage?.body ?? 'No messages yet'}
        </Text>
      </View>
      {item.unreadCount > 0 && (
        <View
          style={{
            backgroundColor: theme.colors.primary,
            borderRadius: 12,
            minWidth: 24,
            paddingHorizontal: 6,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: theme.colors.textOnAccent, fontWeight: '700' }}>
            {item.unreadCount > 99 ? '99+' : item.unreadCount}
          </Text>
        </View>
      )}
    </Pressable>
  );

  return (
    <Screen>
      <ErrorText error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshing={loading}
          onRefresh={() => void reload()}
          ListEmptyComponent={
            <Empty text="No chats yet. Open a friend's profile and tap Message." />
          }
        />
      )}
    </Screen>
  );
}
