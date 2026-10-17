import { Module } from '@nestjs/common';
import { WebLinksController } from './web-links.controller.js';

@Module({ controllers: [WebLinksController] })
export class WebModule {}
