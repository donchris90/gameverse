/**
 * STARTER blocklist. It is deliberately small and English-only and is NOT a finished moderation
 * list. Before launch, moderators must curate it for each launch market, including Nigerian Pidgin,
 * Yoruba, Igbo and Hausa terms, which this file does not cover. See docs/decisions.md.
 *
 * - STRICT terms are unambiguous enough to reject even inside a longer string ("xxfuckxx").
 * - WORD terms only match as whole words, to avoid blocking innocent text ("Essex", "class").
 */
export const STRICT_TERMS: readonly string[] = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'whore',
  'slut',
  'rapist',
  'nazi',
  'hitler',
  'porn',
];

export const WORD_TERMS: readonly string[] = ['ass', 'dick', 'cock', 'rape', 'kys', 'sex'];

/** Names that imply staff or system authority. Matched after normalisation. */
export const RESERVED_NAMES: readonly string[] = [
  'admin',
  'administrator',
  'moderator',
  'mod',
  'staff',
  'support',
  'system',
  'official',
  'gameverse',
  'security',
  'root',
  'help',
  'bot',
];

/** Known innocent words that contain a STRICT term (the "Scunthorpe problem"). Extend as found. */
export const INNOCENT_WORDS: readonly string[] = ['scunthorpe', 'shitake'];
