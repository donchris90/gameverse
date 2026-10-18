import type { NodeOptions } from '@sentry/node';
import { afterEach, describe, expect, it } from 'vitest';
import { SentryErrorReporter } from './error-reporter.js';

type Transport = ReturnType<NonNullable<NodeOptions['transport']>>;
type Envelope = Parameters<Transport['send']>[0];

describe('SentryErrorReporter (real SDK, fake transport)', () => {
  const sent: Envelope[] = [];
  let reporter: SentryErrorReporter | null = null;

  const transport = (): Transport => ({
    send: (envelope) => {
      sent.push(envelope);
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  });

  afterEach(async () => {
    await reporter?.flush();
    reporter = null;
    sent.length = 0;
  });

  it('sends a scrubbed event tagged with the request id, and nothing identifying', async () => {
    reporter = new SentryErrorReporter({
      dsn: 'https://publickey@o0.ingest.sentry.io/0',
      environment: 'test',
      transport,
    });
    const email = ['jude', 'example.com'].join('@');
    reporter.capture(new Error(`boom for ${email}`), {
      requestId: 'req-1',
      route: 'POST /v1/matches/:id/moves',
      userId: 'user-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const text = JSON.stringify(sent);
    expect(text).toContain('req-1');
    expect(text).toContain('POST /v1/matches/:id/moves');
    expect(text).toContain('user-1');
    expect(text).not.toContain(email);
    expect(text).toContain('[email]');
    expect(text).not.toContain('"vars"'); // no local variable values
  });
});
