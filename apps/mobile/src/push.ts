import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { me } from './api-client';

/**
 * UNVERIFIED: written against the Expo docs but never run on a real device with a real EAS project
 * id. Registration needs a physical phone, an Expo project id and (for Android) FCM credentials.
 */
let registeredToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
});

export type PushRegistration = 'registered' | 'denied' | 'unavailable';

export async function registerForPush(): Promise<PushRegistration> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unavailable';
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  if (!projectId) return 'unavailable';

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return 'denied';

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Messages and friends',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await me.registerDevice(data, Platform.OS === 'ios' ? 'IOS' : 'ANDROID');
  registeredToken = data;
  return 'registered';
}

/** Stops pushes for this phone; called on sign-out so the next account on it is not notified. */
export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  await me.unregisterDevice(token);
}
