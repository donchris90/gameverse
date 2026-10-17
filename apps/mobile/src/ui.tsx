import { theme } from '@gameverse/design-system';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { describeError } from './http';

const c = theme.colors;
const s = theme.spacing;

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: c.textSecondary }]}>{children}</Text>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const text = typeof error === 'string' ? error : describeError(error);
  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
      {text}
    </Text>
  );
}

type Tone = 'primary' | 'secondary' | 'danger';

export function Button(props: {
  label: string;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
  busy?: boolean;
}) {
  const tone = props.tone ?? 'primary';
  const disabled = props.disabled || props.busy;
  const background =
    tone === 'primary' ? c.primary : tone === 'danger' ? c.accentCoral : c.surfaceRaised;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!disabled, busy: !!props.busy }}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed && tone === 'primary' ? c.primaryPressed : background,
          borderColor: tone === 'secondary' ? c.borderStrong : background,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={c.textOnAccent} />
      ) : (
        <Text style={styles.buttonLabel}>{props.label}</Text>
      )}
    </Pressable>
  );
}

export function TextField(props: TextInputProps & { label: string; error?: string | null }) {
  const { label, error, style, ...input } = props;
  return (
    <View style={{ marginBottom: s.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.textMuted}
        style={[styles.input, error ? { borderColor: c.danger } : null, style]}
        {...input}
      />
      {error ? <ErrorText error={error} /> : null}
    </View>
  );
}

const AVATAR_COLORS = [
  '#6A47F5',
  '#1F6FE0',
  '#C8352F',
  '#0F8F6B',
  '#B26A00',
  '#8E3FB3',
  '#00798C',
  '#B8386D',
  '#4C6B1F',
  '#5B5FC7',
  '#9C4A1A',
  '#2E7D9A',
];

/** Avatars are a fixed set of ids; until artwork exists each is a coloured disc with the initial. */
export function Avatar(props: {
  avatarId: string;
  name: string;
  size?: number;
  online?: boolean | null;
}) {
  const size = props.size ?? 44;
  const index = Math.max(0, Number.parseInt(props.avatarId.replace(/\D/g, ''), 10) - 1) % 12;
  return (
    <View
      accessible
      accessibilityLabel={`${props.name} avatar${props.online ? ', online' : ''}`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: AVATAR_COLORS[index] ?? c.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: c.textOnAccent, fontSize: size * 0.42, fontWeight: '700' }}>
        {props.name.slice(0, 1).toUpperCase()}
      </Text>
      {props.online ? (
        <View
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: size * 0.28,
            height: size * 0.28,
            borderRadius: size * 0.14,
            backgroundColor: c.online,
            borderWidth: 2,
            borderColor: c.background,
          }}
        />
      ) : null}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={{ padding: s.xl, alignItems: 'center' }}>
      <Text style={{ color: c.textSecondary, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: s.xl }}>
      <ActivityIndicator color={c.primary} accessibilityLabel="Loading" />
    </View>
  );
}

/** Loads on mount and when `load` changes; `reload` re-runs it. Ignores results of stale calls. */
export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const runId = useRef(0);
  const reload = useCallback(async () => {
    const id = (runId.current += 1);
    setLoading(true);
    try {
      const value = await load();
      if (id !== runId.current) return;
      setData(value);
      setError(null);
    } catch (err) {
      if (id === runId.current) setError(err);
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, loading, reload };
}

/** Runs an action and tracks busy/error state so every button can show progress and failures. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError(null) };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background, padding: s.lg },
  title: { color: c.textPrimary, fontSize: 28, fontWeight: '700', marginBottom: s.md },
  body: { color: c.textPrimary, fontSize: 16, lineHeight: 24 },
  error: { color: c.danger, fontSize: 14, marginTop: s.xs, marginBottom: s.sm },
  label: { color: c.textSecondary, fontSize: 14, marginBottom: s.xs },
  input: {
    backgroundColor: c.surface,
    color: c.textPrimary,
    borderColor: c.borderStrong,
    borderWidth: 1,
    borderRadius: theme.radii.sm,
    paddingHorizontal: s.md,
    paddingVertical: s.md,
    fontSize: 16,
    minHeight: 48,
  },
  button: {
    minHeight: 48,
    borderRadius: theme.radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s.lg,
    marginBottom: s.sm,
  },
  buttonLabel: { color: c.textOnAccent, fontSize: 16, fontWeight: '600' },
});
