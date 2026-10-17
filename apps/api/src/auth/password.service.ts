import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/** argon2id at the OWASP-recommended minimum cost (19 MiB, 2 iterations, 1 lane). */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Malformed hash or backend failure: treat as a failed verification, never as success.
      return false;
    }
  }

  /**
   * Burns the same CPU time as a real verification. Called when the account does not exist (or has
   * no password) so login latency does not reveal which emails are registered.
   */
  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= argon2.hash('gameverse-timing-equaliser', ARGON2_OPTIONS);
    await this.verify(await this.dummyHash, password);
  }
}
