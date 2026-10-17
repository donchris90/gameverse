import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './admin.controller.js';
import { AuditService } from './audit.service.js';
import { ModerationService } from './moderation.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController, AdminController],
  providers: [ReportsService, ModerationService, AuditService, RolesGuard],
  exports: [ModerationService, ReportsService, AuditService],
})
export class ModerationModule {}
