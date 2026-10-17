import { describe, expect, it } from 'vitest';
import { botActionId } from './bot-action-id.js';

const MATCH = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000';

describe('botActionId', () => {
  it('is a valid UUID', () => {
    expect(botActionId(MATCH, 3)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is the same for the same match and version, different otherwise', () => {
    expect(botActionId(MATCH, 3)).toBe(botActionId(MATCH, 3));
    expect(botActionId(MATCH, 3)).not.toBe(botActionId(MATCH, 4));
    expect(botActionId(MATCH, 3)).not.toBe(botActionId('0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001', 3));
  });
});
