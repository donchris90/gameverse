import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { WebLinksController } from './web-links.controller.js';

@Module({ imports: [UsersModule], controllers: [WebLinksController] })
export class WebModule {}
