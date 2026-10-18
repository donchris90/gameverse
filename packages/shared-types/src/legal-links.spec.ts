import { describe, expect, it } from 'vitest';
import { legalLinks } from './legal-links.js';

describe('legalLinks', () => {
  it('shows nothing when nothing is configured', () => {
    expect(legalLinks({})).toEqual([]);
    expect(legalLinks({ privacy: '', terms: '  ', support: '' })).toEqual([]);
  });

  it('shows each configured link, documents first', () => {
    expect(
      legalLinks({
        support: 'help@gameverse.example',
        privacy: 'https://gameverse.example/privacy',
        terms: 'https://gameverse.example/terms',
      }).map((link) => link.label),
    ).toEqual(['Privacy policy', 'Terms of service', 'Contact support']);
    expect(legalLinks({ support: 'help@gameverse.example' })[0]?.url).toBe(
      'mailto:help@gameverse.example',
    );
  });

  it('refuses anything that is not https or not an address', () => {
    expect(
      legalLinks({
        privacy: 'http://insecure.example/p',
        terms: 'javascript:alert(1)',
        support: 'not an address',
      }),
    ).toEqual([]);
  });
});
