import { Body, Controller, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { createReportSchema } from '@gameverse/shared-types';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ReportsService, type CreateReportBody } from './reports.service.js';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** 201 for a new report, 200 when an identical open report already exists. */
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReportBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ id: string }> {
    const result = await this.reports.create(user.id, body);
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return { id: result.id };
  }
}
