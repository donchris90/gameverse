import { Redirect } from 'expo-router';
import { useSession } from '../src/session';
import { Loading } from '../src/ui';

/**
 * The app's start address ("/"). It owns no screen of its own: it sends the person to the one
 * their session allows. Without it, Expo Router reports "Unmatched Route" at launch, because no
 * screen answers "/".
 */
export default function Start() {
  const { state } = useSession();
  switch (state.status) {
    case 'loading':
      return <Loading />;
    case 'signed-out':
      return <Redirect href="/(auth)/sign-in" />;
    case 'needs-profile':
      return <Redirect href="/onboarding" />;
    case 'ready':
      return <Redirect href="/(tabs)/play" />;
  }
}
