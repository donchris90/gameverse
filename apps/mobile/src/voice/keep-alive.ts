import notifee, { AndroidForegroundServiceType, AndroidImportance } from '@notifee/react-native';
import { Platform } from 'react-native';

const CHANNEL_ID = 'voice';
const NOTIFICATION_ID = 'voice-in-match';

let registered = false;

/**
 * Android only: call once at startup. The foreground service needs a long-running task; ours just
 * stays alive until `stopVoiceKeepAlive` stops the service.
 */
export function registerVoiceKeepAlive(): void {
  if (Platform.OS !== 'android' || registered) return;
  registered = true;
  notifee.registerForegroundService(() => new Promise<void>(() => undefined));
}

/**
 * Keeps the microphone alive while the app is in the background. Android needs a foreground
 * service with a visible notification; iOS keeps audio running through the "audio" background
 * mode set in app.json, so there is nothing to start there. Best effort: a failure here must
 * never stop voice itself. Unverified on a device.
 */
export async function startVoiceKeepAlive(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await notifee.createChannel({
      id: CHANNEL_ID,
      name: 'Voice in match',
      importance: AndroidImportance.LOW,
    });
    await notifee.displayNotification({
      id: NOTIFICATION_ID,
      title: 'GameVerse voice is on',
      body: 'Tap to return to your match.',
      android: {
        channelId: CHANNEL_ID,
        asForegroundService: true,
        ongoing: true,
        foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE],
        pressAction: { id: 'default' },
      },
    });
  } catch {
    // Voice still works while the app is in the foreground.
  }
}

export async function stopVoiceKeepAlive(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await notifee.stopForegroundService();
  } catch {
    // Already stopped.
  }
}
