import { randomUUID } from 'node:crypto';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { buildThrottlers } from './common/rate-limit.js';
import type { AppConfig } from './config/config.js';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { SocialModule } from './social/social.module.js';
import { ChatModule } from './chat/chat.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { ModerationModule } from './moderation/moderation.module.js';
import { UsersModule } from './users/users.module.js';
import { VoiceModule } from './voice/voice.module.js';

const REQUEST_ID_PATTERN = /^[\w-]{8,64}$/;

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.register(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            // Honour a well-formed inbound request id (for tracing across services), else mint one.
            genReqId: (request, response) => {
              const inbound = request.headers['x-request-id'];
              const id =
                typeof inbound === 'string' && REQUEST_ID_PATTERN.test(inbound)
                  ? inbound
                  : randomUUID();
              response.setHeader('x-request-id', id);
              return id;
            },
            // Request/response bodies are never logged. Credentials in headers are redacted anyway.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
            serializers: {
              req: (request: { id: string; method: string; url: string }) => ({
                id: request.id,
                method: request.method,
                url: request.url?.split('?')[0],
              }),
              res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
            },
            autoLogging: { ignore: (request) => request.url?.startsWith('/health') ?? false },
            ...(config.NODE_ENV === 'development'
              ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
              : {}),
          },
        }),
        ThrottlerModule.forRoot({ throttlers: buildThrottlers(config) }),
        PrismaModule,
        AuthModule,
        ProfilesModule,
        SocialModule,
        RealtimeModule,
        ChatModule,
        ModerationModule,
        UsersModule,
        VoiceModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
