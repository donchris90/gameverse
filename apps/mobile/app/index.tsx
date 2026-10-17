import { theme } from '@gameverse/design-system';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { checkApiReady, type ReadyResult } from '../src/api';

export default function Home() {
  const [ready, setReady] = useState<ReadyResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void checkApiReady(controller.signal).then(setReady);
    return () => controller.abort();
  }, []);

  const status =
    ready === null
      ? 'Checking server…'
      : ready.kind === 'ok'
        ? 'Server is reachable'
        : ready.kind === 'not-ready'
          ? `Server responded ${String(ready.status)}`
          : 'Cannot reach the server';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>GameVerse</Text>
      <Text accessibilityRole="text" style={styles.status}>
        {status}
      </Text>
      {__DEV__ ? (
        <Link href="/voice-spike" style={styles.link}>
          Voice spike (development builds only)
        </Link>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.textPrimary, fontSize: 32, fontWeight: '700' },
  link: { color: theme.colors.accentBlue, marginTop: theme.spacing.xl, fontSize: 16 },
  status: { color: theme.colors.textSecondary, marginTop: theme.spacing.sm, fontSize: 16 },
});
