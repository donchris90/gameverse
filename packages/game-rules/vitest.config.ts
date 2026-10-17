import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Several specs play every possible game or every bot position. That is a few seconds of pure
    // CPU on a quiet machine and more when turbo runs other packages' tests at the same time.
    testTimeout: 60_000,
  },
});
