import { theme } from '@gameverse/design-system';
import { Tabs, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import type { ColorValue } from 'react-native';
import { registerForPush } from '../../src/push';
import { TabIcon, type TabIconName } from '../../src/TabIcons';

const icon =
  (name: TabIconName) =>
  ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <TabIcon name={name} color={color} size={size} focused={focused} />
  );

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
      <Tabs.Screen name="play" options={{ title: 'Play', tabBarIcon: icon('play') }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats', tabBarIcon: icon('chats') }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends', tabBarIcon: icon('friends') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings') }} />
    </Tabs>
  );
}
