import type { SoundName } from '@gameverse/shared-types';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';

/**
 * Game sound effects (short WAV files made by `scripts/make-sounds.mjs`). A phone that cannot play
 * them, or a player who turned them off in Settings, must never break a game, so every call here
 * swallows its errors. Needs the `expo-audio` native module: it only works in a dev build made
 * after that package was added.
 */
const SOURCES: Record<SoundName, number> = {
  tap: require('../assets/sounds/tap.wav') as number,
  place: require('../assets/sounds/place.wav') as number,
  capture: require('../assets/sounds/capture.wav') as number,
  seed: require('../assets/sounds/seed.wav') as number,
  lift: require('../assets/sounds/lift.wav') as number,
  pack: require('../assets/sounds/pack.wav') as number,
  roll: require('../assets/sounds/roll.wav') as number,
  home: require('../assets/sounds/home.wav') as number,
  turn: require('../assets/sounds/turn.wav') as number,
  win: require('../assets/sounds/win.wav') as number,
  lose: require('../assets/sounds/lose.wav') as number,
  draw: require('../assets/sounds/draw.wav') as number,
};

const KEY = 'sound.enabled';
type Listener = (on: boolean) => void;

let enabled = true;
let loaded = false;
let modeSet = false;
const players = new Map<SoundName, AudioPlayer>();
const listeners = new Set<Listener>();

async function loadPreference(): Promise<boolean> {
  if (loaded) return enabled;
  loaded = true;
  try {
    enabled = (await SecureStore.getItemAsync(KEY)) !== '0';
  } catch {
    enabled = true;
  }
  return enabled;
}

/** Saves the player's choice (on by default). */
export async function setSoundEnabled(value: boolean): Promise<void> {
  loaded = true;
  enabled = value;
  try {
    await SecureStore.setItemAsync(KEY, value ? '1' : '0');
  } catch {
    // The choice still applies for this session.
  }
  for (const listener of listeners) listener(value);
}

export function useSoundEnabled(): boolean {
  const [on, setOn] = useState(enabled);
  useEffect(() => {
    let live = true;
    void loadPreference().then((value) => {
      if (live) setOn(value);
    });
    listeners.add(setOn);
    return () => {
      live = false;
      listeners.delete(setOn);
    };
  }, []);
  return on;
}

/** Plays one effect from the start. Never throws. */
export function playSound(name: SoundName): void {
  void (async () => {
    try {
      if (!(await loadPreference())) return;
      if (!modeSet) {
        modeSet = true;
        // Effects never stop or silence voice chat or the player's music, and obey the silent switch.
        await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
      }
      let player = players.get(name);
      if (!player) {
        player = createAudioPlayer(SOURCES[name]);
        players.set(name, player);
      }
      await player.seekTo(0);
      player.play();
    } catch {
      // Sound is a nicety.
    }
  })();
}
