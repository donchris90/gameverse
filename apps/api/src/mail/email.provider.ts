import { Logger } from '@nestjs/common';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Transport boundary. Implementations: console and memory (dev/test) and resend (HTTPS API). */
export abstract class EmailProvider {
  abstract send(message: EmailMessage): Promise<void>;
}

/**
 * DEVELOPMENT ONLY. Prints the full message (including verification / reset links) to the log so a
 * developer can click them. Configuration validation refuses this provider in staging/production.
 */
export class ConsoleEmailProvider extends EmailProvider {
  private readonly logger = new Logger('ConsoleEmailProvider');

  override async send(message: EmailMessage): Promise<void> {
    this.logger.warn(
      `[DEV EMAIL - not sent over the network]\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
    );
  }
}

/** TEST ONLY. Captures messages so tests can read the links that real users would receive. */
export class MemoryEmailProvider extends EmailProvider {
  readonly outbox: EmailMessage[] = [];

  override async send(message: EmailMessage): Promise<void> {
    this.outbox.push(message);
  }

  clear(): void {
    this.outbox.length = 0;
  }

  last(to?: string): EmailMessage | undefined {
    const matches = to ? this.outbox.filter((m) => m.to === to) : this.outbox;
    return matches[matches.length - 1];
  }
}

/**
 * Sends through the Resend HTTP API. UNVERIFIED against the live service: it follows the documented
 * request shape (POST with a Bearer key, from/to/subject/text), is tested only against a local
 * stand-in, and needs a real API key and a sending domain verified with the provider.
 * Errors never include the message body, because bodies contain one-time links.
 */
export class ResendEmailProvider extends EmailProvider {
  private readonly logger = new Logger('ResendEmailProvider');

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly url: string,
    private readonly timeoutMs = 10_000,
  ) {
    super();
  }

  override async send(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      this.logger.warn(`Email request failed: ${error instanceof Error ? error.name : 'unknown'}`);
      throw new Error('Email provider is unreachable');
    }
    if (!response.ok) {
      this.logger.warn(`Email provider answered ${String(response.status)}`);
      throw new Error(`Email provider rejected the message (${String(response.status)})`);
    }
  }
}
