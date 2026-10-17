import { INNOCENT_WORDS, RESERVED_NAMES, STRICT_TERMS, WORD_TERMS } from './blocklist.js';

const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
};

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[013457@$!]/g, (char) => LEET[char] ?? char);
}

/** Letters only, separators removed: catches "f.u_c k". Used for the strict check. */
function squash(text: string): string {
  return fold(text).replace(/[^a-z]/g, '');
}

/** Whole words only: catches "dick" but not "Dickens". Used for the word check. */
function words(text: string): string[] {
  return fold(text)
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0);
}

export function containsBlockedTerm(text: string): boolean {
  let squashed = squash(text);
  for (const word of INNOCENT_WORDS) squashed = squashed.split(word).join('');
  if (STRICT_TERMS.some((term) => squashed.includes(term))) return true;
  const tokens = words(text);
  return tokens.some((token) => WORD_TERMS.includes(token));
}

/** Reserved names that must not appear anywhere in a username (impersonation of the product/staff). */
const IMPERSONATION_SUBSTRINGS = ['gameverse', 'administrator', 'moderator'];

/**
 * Names reserved for staff/system. Trailing digits and underscores are ignored, so "Admin_01" is
 * reserved but "Modi" is not reserved by "mod".
 */
export function isReservedName(username: string): boolean {
  const base = squash(username.replace(/[0-9_]+$/, ''));
  if (RESERVED_NAMES.includes(base)) return true;
  const whole = squash(username);
  return IMPERSONATION_SUBSTRINGS.some((fragment) => whole.includes(fragment));
}

/** Usernames are checked strictly (no word-boundary escape hatch) and against reserved names. */
export function isUsernameAllowed(username: string): boolean {
  return !containsBlockedTerm(username) && !isReservedName(username);
}
