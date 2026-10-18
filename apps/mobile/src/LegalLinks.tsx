import { theme } from '@gameverse/design-system';
import { legalLinks } from '@gameverse/shared-types';
import { Linking, Pressable, Text, View } from 'react-native';

/**
 * Where the published privacy policy, terms and support address live. Set at build time; a row only
 * appears when its value exists, so there is never a link that goes nowhere. The store listings
 * need the same privacy URL, and Apple expects reachable contact details for user-generated content.
 */
const PRIVACY_URL = process.env['EXPO_PUBLIC_PRIVACY_URL'];
const TERMS_URL = process.env['EXPO_PUBLIC_TERMS_URL'];
const SUPPORT_EMAIL = process.env['EXPO_PUBLIC_SUPPORT_EMAIL'];

export function LegalLinks({ only }: { only?: readonly string[] }) {
  const links = legalLinks({
    privacy: PRIVACY_URL,
    terms: TERMS_URL,
    support: SUPPORT_EMAIL,
  }).filter((link) => !only || only.includes(link.label));
  if (links.length === 0) return null;
  return (
    <View style={{ marginVertical: theme.spacing.md }}>
      {links.map((link) => (
        <Pressable
          key={link.label}
          accessibilityRole="link"
          accessibilityLabel={link.label}
          onPress={() => void Linking.openURL(link.url)}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: theme.colors.accentBlue, fontSize: 16 }}>{link.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
