import type { MicPermission } from '@gameverse/shared-types';
import { Linking, PermissionsAndroid, Platform } from 'react-native';

/**
 * Asks for the microphone the first time the player taps "Join voice" (never at app start).
 * 'blocked' means the system will not show the prompt again, so the app must send the player to
 * Settings. iOS asks by itself when the audio engine first opens the microphone, so it reports
 * granted here and a refusal there surfaces as an engine error.
 */
export async function requestMicrophone(): Promise<MicPermission> {
  if (Platform.OS !== 'android') return 'granted';
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
  return 'denied';
}

export function openAppSettings(): void {
  void Linking.openSettings();
}
