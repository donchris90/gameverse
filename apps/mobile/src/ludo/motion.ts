import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

const KEY = 'ludo.reduceMotion';

/**
 * Whether Ludo should skip the hopping and pulsing animations. The player's own choice (Settings)
 * wins; with no choice it follows the phone's "reduce motion" setting, and starts on for older
 * Android versions (9 and below) as a guess at a slow phone. That guess has NOT been measured on a
 * real low-end device.
 */
export function defaultReduced(osReduceMotion: boolean): boolean {
  if (osReduceMotion) return true;
  return Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version < 29;
}

type Listener = (value: boolean | null) => void;
let stored: boolean | null | undefined;
const listeners = new Set<Listener>();

async function load(): Promise<boolean | null> {
  if (stored !== undefined) return stored;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    stored = raw === '1' ? true : raw === '0' ? false : null;
  } catch {
    stored = null;
  }
  return stored;
}

/** Saves the choice; null goes back to "follow the phone". */
export async function setReduceMotionChoice(value: boolean | null): Promise<void> {
  stored = value;
  try {
    if (value === null) await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, value ? '1' : '0');
  } catch {
    // The choice still applies for this session.
  }
  for (const listener of listeners) listener(value);
}

export function useReduceMotion(): { reduced: boolean; choice: boolean | null } {
  const [choice, setChoice] = useState<boolean | null>(stored ?? null);
  const [os, setOs] = useState(false);

  useEffect(() => {
    let live = true;
    void load().then((value) => {
      if (live) setChoice(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setOs(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setOs);
    listeners.add(setChoice);
    return () => {
      live = false;
      subscription.remove();
      listeners.delete(setChoice);
    };
  }, []);

  return { reduced: choice ?? defaultReduced(os), choice };
}
