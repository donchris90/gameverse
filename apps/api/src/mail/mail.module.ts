import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { ConsoleEmailProvider, EmailProvider, MemoryEmailProvider } from './email.provider.js';
import { MailService } from './mail.service.js';

@Module({
  providers: [
    {
      provide: EmailProvider,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailProvider =>
        config.EMAIL_PROVIDER === 'memory' ? new MemoryEmailProvider() : new ConsoleEmailProvider(),
    },
    MailService,
  ],
  exports: [MailService, EmailProvider],
})
export class MailModule {}
