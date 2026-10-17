import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminUserDetail,
  type AdminUserSummary,
  type AuditLogView,
  type Page,
  type ReportView,
  adminUserSearchSchema,
  auditQuerySchema,
  changeRoleSchema,
  dismissReportSchema,
  moderationActionSchema,
  reportsQuerySchema,
  userIdSchema,
} from '@gameverse/shared-types';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuditService } from './audit.service.js';
import { ModerationService } from './moderation.service.js';
import { ReportsService } from './reports.service.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

const idParam = (name: string) => Param(name, new ZodValidationPipe(userIdSchema));
type ActionBody = z.output<typeof moderationActionSchema>;

/** Staff endpoints. Every route needs a role; the guard refuses routes that declare none. */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('MODERATOR', 'ADMIN')
export class AdminController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  searchUsers(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(adminUserSearchSchema))
    query: z.output<typeof adminUserSearchSchema>,
  ): Promise<AdminUserSummary[]> {
    return this.moderation.search(actor, query.q);
  }

  @Get('users/:userId')
  userDetail(
    @CurrentUser() actor: AuthUser,
    @idParam('userId') userId: string,
  ): Promise<AdminUserDetail> {
    return this.moderation.detail(actor, userId);
  }

  @Post('users/:userId/ban')
  @HttpCode(HttpStatus.NO_CONTENT)
  ban(
    @CurrentUser() actor: AuthUser,
    @idParam('userId') userId: string,
    @Body(new ZodValidationPipe(moderationActionSchema)) body: ActionBody,
  ): Promise<void> {
    return this.moderation.applyAction(actor, userId, 'BAN', body.reason, body.reportId);
  }

  @Post('users/:userId/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  suspend(
    @CurrentUser() actor: AuthUser,
    @idParam('userId') userId: string,
    @Body(new ZodValidationPipe(moderationActionSchema)) body: ActionBody,
  ): Promise<void> {
    return this.moderation.applyAction(actor, userId, 'SUSPEND', body.reason, body.reportId);
  }

  @Post('users/:userId/reinstate')
  @HttpCode(HttpStatus.NO_CONTENT)
  reinstate(
    @CurrentUser() actor: AuthUser,
    @idParam('userId') userId: string,
    @Body(new ZodValidationPipe(moderationActionSchema)) body: ActionBody,
  ): Promise<void> {
    return this.moderation.applyAction(actor, userId, 'REINSTATE', body.reason, body.reportId);
  }

  @Patch('users/:userId/role')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  changeRole(
    @CurrentUser() actor: AuthUser,
    @idParam('userId') userId: string,
    @Body(new ZodValidationPipe(changeRoleSchema)) body: z.output<typeof changeRoleSchema>,
  ): Promise<void> {
    return this.moderation.changeRole(actor, userId, body.role, body.reason);
  }

  @Get('reports')
  listReports(
    @Query(new ZodValidationPipe(reportsQuerySchema)) query: z.output<typeof reportsQuerySchema>,
  ): Promise<Page<ReportView>> {
    return this.reports.list(query.status, query.limit, query.cursor);
  }

  @Get('reports/:reportId')
  getReport(@idParam('reportId') reportId: string): Promise<ReportView> {
    return this.reports.get(reportId);
  }

  @Post('reports/:reportId/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  dismissReport(
    @CurrentUser() actor: AuthUser,
    @idParam('reportId') reportId: string,
    @Body(new ZodValidationPipe(dismissReportSchema)) body: z.output<typeof dismissReportSchema>,
  ): Promise<void> {
    return this.reports.dismiss(actor.id, reportId, body.note);
  }

  @Get('audit-logs')
  @Roles('ADMIN')
  auditLogs(
    @Query(new ZodValidationPipe(auditQuerySchema)) query: z.output<typeof auditQuerySchema>,
  ): Promise<Page<AuditLogView>> {
    return this.audit.list(query);
  }
}
