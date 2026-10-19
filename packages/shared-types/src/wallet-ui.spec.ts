import { describe, expect, it } from 'vitest';
import { coinBanner, coinReasonLabel, entrySummary, formatCoins } from './wallet-ui.js';
import { COIN_REASONS, type WalletView } from './wallet.js';

const wallet = (over: Partial<WalletView> = {}): WalletView => ({
  balance: 1250,
  dailyAmount: 50,
  canClaimDaily: false,
  nextDailyAt: null,
  history: [],
  ...over,
});

describe('coin banner', () => {
  it('offers the daily claim when it is open', () => {
    const banner = coinBanner(wallet({ canClaimDaily: true }));
    expect(banner.balanceText).toBe('1,250');
    expect(banner.claimLabel).toBe('Claim 50 daily coins');
  });

  it('shows when the next claim opens, rounded up to whole hours', () => {
    const now = new Date('2026-10-18T20:30:00Z');
    const banner = coinBanner(wallet({ nextDailyAt: '2026-10-19T00:00:00.000Z' }), now);
    expect(banner.claimLabel).toBeNull();
    expect(banner.note).toBe('Next daily coins in about 4 hours');
    expect(
      coinBanner(
        wallet({ nextDailyAt: '2026-10-19T00:00:00.000Z' }),
        new Date('2026-10-18T23:30:00Z'),
      ).note,
    ).toBe('Next daily coins in about 1 hour');
  });

  it('always says the coins are free play coins that cannot be cashed out', () => {
    expect(coinBanner(wallet()).accessibilityLabel).toContain('cannot be bought or cashed out');
  });

  it('has a label for every ledger reason and a safe one for anything else', () => {
    for (const reason of COIN_REASONS) expect(coinReasonLabel(reason)).not.toBe('Bonus coins');
    expect(coinReasonLabel('SOMETHING_NEW')).toBe('Bonus coins');
    expect(formatCoins(1234567)).toBe('1,234,567');
  });
});

describe('entry summary', () => {
  const base = {
    entryFee: 100,
    pot: 200,
    payout: 0,
    status: 'ACTIVE',
    winnerSeat: null,
    mySeat: 0,
  };
  it('says nothing for a free match', () => {
    expect(entrySummary({ ...base, entryFee: 0, pot: 0 })).toBeNull();
  });
  it('states the entry and the pot while the match is open', () => {
    expect(entrySummary(base)).toBe('Entry 100 bonus coins. Winner takes 200.');
  });
  it('says how a finished match ended for this player', () => {
    expect(entrySummary({ ...base, status: 'COMPLETED', winnerSeat: 0, payout: 200 })).toBe(
      'You won 200 bonus coins.',
    );
    expect(entrySummary({ ...base, status: 'COMPLETED', winnerSeat: 1 })).toBe(
      'You lost your 100 entry coins.',
    );
    expect(entrySummary({ ...base, status: 'COMPLETED', winnerSeat: null })).toBe(
      'Draw. Your 100 entry coins were returned.',
    );
  });
  it('names a share of the pot, and the two-thirds rule at a four-player Ludo table', () => {
    const ludo4 = { ...base, gameId: 'ludo', players: [0, 1, 2, 3], pot: 400 };
    expect(entrySummary(ludo4)).toBe(
      'Entry 100 bonus coins. Pot 400: first takes two thirds, second one third.',
    );
    const done = { ...ludo4, status: 'COMPLETED' };
    expect(entrySummary({ ...done, winnerSeat: 1, mySeat: 1, payout: 266 })).toBe(
      'You received 266 bonus coins.',
    );
    expect(entrySummary({ ...done, winnerSeat: 1, mySeat: 2, payout: 134 })).toBe(
      'You received 134 bonus coins.',
    );
    expect(entrySummary({ ...done, winnerSeat: 1, mySeat: 3, payout: 0 })).toBe(
      'You lost your 100 entry coins.',
    );
  });
  it('says the coins came back when the match never started', () => {
    for (const status of ['CANCELLED', 'EXPIRED', 'ABANDONED']) {
      expect(entrySummary({ ...base, status })).toBe(
        'Match did not start. Your 100 entry coins were returned.',
      );
    }
  });
});
