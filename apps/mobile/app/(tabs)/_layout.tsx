import { theme } from '@gameverse/design-system';
import { Tabs, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { registerForPush } from '../../src/push';

export default function TabsLayout() {
  const router = useRouter();

  // Best effort: pushes are a convenience, never a requirement for using the app.
  useEffect(() => {
    void registerForPush().catch(() => undefined);
  }, []);

  // Tapping a notification opens the thing it is about. The payload carries ids only.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (data['type'] === 'MESSAGE' && typeof data['conversationId'] === 'string') {
        router.push({ pathname: '/chat/[id]', params: { id: data['conversationId'] } });
      } else if (data['type'] === 'GAME_INVITE') {
        router.push('/(tabs)/play');
      } else if (data['type'] === 'FRIEND_REQUEST' || data['type'] === 'FRIEND_ACCEPTED') {
        router.push('/(tabs)/friends');
      }
    });
    return () => subscription.remove();
  }, [router]);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen name="play" options={{ title: 'Play' }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
