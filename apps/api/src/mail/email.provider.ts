import { Logger } from '@nestjs/common';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Transport boundary. A production implementation (SMTP / API provider) is NOT integrated yet. */
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
