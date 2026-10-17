import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { loadConfig } from './config/config.js';

async function bootstrap(): Promise<void> {
  // Throws a ConfigError naming every invalid variable (never its value) and stops startup.
  const config = loadConfig(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bufferLogs: true,
  });
  configureApp(app, config);
  await app.listen(config.PORT);
}

await bootstrap();
