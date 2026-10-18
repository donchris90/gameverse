import { describe, expect, it } from 'vitest';
import { coinBanner, coinReasonLabel, formatCoins } from './wallet-ui.js';
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
