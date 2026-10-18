export interface LegalLink {
  label: 'Privacy policy' | 'Terms of service' | 'Contact support';
  url: string;
}

/**
 * Which legal and contact links the app may show. A link appears only when its value is usable:
 * https for documents, something with an "@" for the support address. Nothing is shown that would
 * lead nowhere.
 */
export function legalLinks(env: {
  privacy?: string | undefined;
  terms?: string | undefined;
  support?: string | undefined;
}): LegalLink[] {
  const links: LegalLink[] = [];
  const privacy = env.privacy?.trim();
  const terms = env.terms?.trim();
  const support = env.support?.trim();
  if (privacy?.startsWith('https://')) links.push({ label: 'Privacy policy', url: privacy });
  if (terms?.startsWith('https://')) links.push({ label: 'Terms of service', url: terms });
  if (support && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(support)) {
    links.push({ label: 'Contact support', url: `mailto:${support}` });
  }
  return links;
}
