import { describe, expect, it } from 'vitest';
import { voiceChannelForMatch, voiceUidForSeat } from './voice.js';

describe('voice ids', () => {
  it('uids are seat + 1: never zero, unique inside a match', () => {
    expect(voiceUidForSeat(0)).toBe(1);
    expect(voiceUidForSeat(1)).toBe(2);
    expect(new Set([0, 1, 2, 3].map(voiceUidForSeat)).size).toBe(4);
    expect([0, 1, 2, 3].map(voiceUidForSeat).every((uid) => uid > 0)).toBe(true);
  });

  it('the channel is match_ plus the id without dashes, within Agora’s 64 character limit', () => {
    const channel = voiceChannelForMatch('0190e5a0-1234-7abc-8def-0123456789ab');
    expect(channel).toBe('match_0190e5a01234 7abc8def0123456789ab'.replace(' ', ''));
    expect(channel.length).toBeLessThanOrEqual(64);
    expect(channel).toMatch(/^[A-Za-z0-9_]+$/);
  });
});
