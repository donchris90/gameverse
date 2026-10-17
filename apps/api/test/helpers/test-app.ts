import 'dotenv/config';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap.js';
import { type AppConfig, loadConfig } from '../../src/config/config.js';
import { MemoryEmailProvider } from '../../src/mail/email.provider.js';
import { EmailProvider } from '../../src/mail/email.provider.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export interface TestApp {
  app: NestExpressApplication;
  config: AppConfig;
  prisma: PrismaService;
  email: MemoryEmailProvider;
  /** The underlying HTTP server, for supertest. */
  server: ReturnType<NestExpressApplication['getHttpServer']>;
  close: () => Promise<void>;
}

/** A fixed, random-looking secret used only by tests. */
export const TEST_JWT_SECRET = 'k7Qm2VxR9tLp4WzN8bYc1JhD6sFg3AeU5oIv0XnT';

export async function createTestApp(
  envOverrides: Record<string, string> = {},
  customise?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestApp> {
  const databaseUrl = process.env['TEST_DATABASE_URL'];
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required to run integration tests');

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: TEST_JWT_SECRET,
    EMAIL_PROVIDER: 'memory',
    // Generous by default so unrelated tests never trip limits; rate-limit tests override these.
    RATE_LIMIT_DEFAULT_PER_MIN: '100000',
    RATE_LIMIT_AUTH_PER_MIN: '10000',
    ...envOverrides,
  });

  let builder = Test.createTestingModule({ imports: [AppModule.register(config)] });
  if (customise) builder = customise(builder);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, config);
  await app.init();

  const email = app.get(EmailProvider) as MemoryEmailProvider;
  return {
    app,
    config,
    prisma: app.get(PrismaService),
    email,
    server: app.getHttpServer(),
    close: () => app.close(),
  };
}

/** Removes every account (and, by cascade, tokens and identities). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.user.deleteMany();
}
