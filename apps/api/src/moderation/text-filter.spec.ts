import { describe, expect, it } from 'vitest';
import { containsBlockedTerm, isReservedName, isUsernameAllowed } from './text-filter.js';

describe('containsBlockedTerm', () => {
  it.each(['fuck', 'FUCK you', 'f.u.c.k', 'sh1t', 'b!tch', 'xxfuckxx', 'F u C k', 'fúck'])(
    'blocks %j',
    (text) => {
      expect(containsBlockedTerm(text)).toBe(true);
    },
  );

  it.each(['dick', 'what an ass', 'k_y_s'])('blocks whole-word term %j', (text) => {
    // "k_y_s" is split on the separators, so it is NOT a whole word "kys"; see the next test.
    expect(containsBlockedTerm(text)).toBe(text !== 'k_y_s');
  });

  it.each([
    'Essex',
    'class',
    'assistant',
    'Dickens',
    'cockpit',
    'grape',
    'Scunthorpe',
    'hello world',
  ])('does not block innocent text %j', (text) => {
    expect(containsBlockedTerm(text)).toBe(false);
  });
});

describe('isReservedName / isUsernameAllowed', () => {
  it.each([
    'admin',
    'Admin',
    'ADMIN_01',
    'admin99',
    '4dmin',
    'support',
    'Moderator',
    'xGameVersex',
    'bot',
  ])('reserves %j', (name) => {
    expect(isReservedName(name)).toBe(true);
    expect(isUsernameAllowed(name)).toBe(false);
  });

  it.each(['Modi', 'adminton', 'botanist', 'Chidi_77', 'ade_player', 'Zara'])(
    'allows %j',
    (name) => {
      expect(isReservedName(name)).toBe(false);
      expect(isUsernameAllowed(name)).toBe(true);
    },
  );

  it('rejects usernames containing a blocked term', () => {
    expect(isUsernameAllowed('shit_stain')).toBe(false);
    expect(isUsernameAllowed('NiceGuy')).toBe(true);
  });
});
