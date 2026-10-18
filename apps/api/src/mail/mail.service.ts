import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { EmailProvider } from './email.provider.js';

/** Builds user-facing emails. Raw one-time tokens exist only here and in the delivered email. */
@Injectable()
export class MailService {
  constructor(
    private readonly provider: EmailProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async sendVerificationEmail(to: string, rawToken: string): Promise<void> {
    const link = `${this.baseUrl()}/verify-email?token=${encodeURIComponent(rawToken)}`;
    await this.provider.send({
      to,
      subject: 'Verify your GameVerse email',
      text: [
        'Welcome to GameVerse!',
        '',
        'Confirm your email address to finish setting up your account:',
        link,
        '',
        'This link expires in 24 hours. If you did not create an account, you can ignore this email.',
      ].join('\n'),
    });
  }

  async sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
    const link = `${this.baseUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
    await this.provider.send({
      to,
      subject: 'Reset your GameVerse password',
      text: [
        'We received a request to reset your GameVerse password.',
        '',
        'Choose a new password here:',
        link,
        '',
        'This link expires in 1 hour. If you did not ask for this, you can ignore this email;',
        'your password will not change.',
      ].join('\n'),
    });
  }

  async sendAccountDeletionEmail(to: string, rawToken: string): Promise<void> {
    const link = `${this.baseUrl()}/delete-account?token=${encodeURIComponent(rawToken)}`;
    await this.provider.send({
      to,
      subject: 'Confirm deleting your GameVerse account',
      text: [
        'We received a request to permanently delete your GameVerse account.',
        '',
        'To confirm, open this link on your phone (in the app, or on the web page it opens):',
        link,
        '',
        'Deleting your account removes your profile, friends, chats and sign-in details. This cannot',
        'be undone. The link expires in 1 hour. If you did not ask for this, ignore this email and',
        'your account will stay as it is; consider changing your password.',
      ].join('\n'),
    });
  }

  private baseUrl(): string {
    return this.config.PUBLIC_WEB_URL.replace(/\/+$/, '');
  }
}
