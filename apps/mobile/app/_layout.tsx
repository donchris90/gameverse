import { theme } from '@gameverse/design-system';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initObservability } from '../src/observability';
import { SessionProvider, useSession } from '../src/session';
import { Loading } from '../src/ui';
import { registerVoiceKeepAlive } from '../src/voice/keep-alive';

initObservability();

// Must run once when the app starts so Android can run the voice foreground service.
registerVoiceKeepAlive();

function Routes() {
  const { state } = useSession();
  if (state.status === 'loading') return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Protected guard={state.status === 'signed-out'}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'needs-profile'}>
        <Stack.Screen
          name="onboarding"
          options={{ title: 'Create your profile', headerBackVisible: false }}
        />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'ready'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="user/[id]" options={{ title: 'Profile' }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
        <Stack.Screen name="match/[id]" options={{ title: 'Match' }} />
        <Stack.Screen name="leaderboard" options={{ title: 'Leaderboard' }} />
        <Stack.Screen name="blocked" options={{ title: 'Blocked players' }} />
        <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
      </Stack.Protected>
      {/* Reachable from email links whether or not anyone is signed in. */}
      <Stack.Screen name="verify-email" options={{ title: 'Verify email' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Reset password' }} />
      <Stack.Protected guard={__DEV__}>
        <Stack.Screen name="dev-tools" options={{ title: 'Developer tools' }} />
        <Stack.Screen name="voice-spike" options={{ title: 'Voice spike' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Routes />
    </SessionProvider>
  );
}
