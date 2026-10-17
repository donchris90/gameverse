import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import {
  ConsoleEmailProvider,
  EmailProvider,
  MemoryEmailProvider,
  ResendEmailProvider,
} from './email.provider.js';
import { MailService } from './mail.service.js';

@Module({
  providers: [
    {
      provide: EmailProvider,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailProvider => {
        switch (config.EMAIL_PROVIDER) {
          case 'memory':
            return new MemoryEmailProvider();
          case 'resend':
            // Config validation guarantees the key exists when this provider is chosen.
            return new ResendEmailProvider(
              config.RESEND_API_KEY ?? '',
              config.EMAIL_FROM,
              config.RESEND_API_URL,
            );
          default:
            return new ConsoleEmailProvider();
        }
      },
    },
    MailService,
  ],
  exports: [MailService, EmailProvider],
})
export class MailModule {}
