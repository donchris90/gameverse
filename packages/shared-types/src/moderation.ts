import { z } from 'zod';
import {
  MODERATION_REASON_MAX_LENGTH,
  MODERATION_REASON_MIN_LENGTH,
  PAGE_SIZE_MAX,
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  REPORT_STATUSES,
  USER_ROLES,
} from './constants.js';
import type { ReportStatus, UserRole, UserStatus } from './constants.js';
import type { Page, UserCard } from './social.js';

export const createReportSchema = z.object({
  userId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z
    .string()
    .trim()
    .max(REPORT_DETAILS_MAX_LENGTH)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .default(null),
  /** Optional: report a specific chat message (it is snapshotted for moderators). */
  messageId: z.uuid().optional(),
});

const moderationReason = z
  .string()
  .trim()
  .min(MODERATION_REASON_MIN_LENGTH)
  .max(MODERATION_REASON_MAX_LENGTH);

export const moderationActionSchema = z.object({
  reason: moderationReason,
  /** If given and still open, this report is resolved by the action. */
  reportId: z.uuid().optional(),
});

export const dismissReportSchema = z.object({ note: moderationReason });

export const reportsQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).default('OPEN'),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(30),
  cursor: z.uuid().optional(),
});

export const adminUserSearchSchema = z.object({
  q: z.string().trim().min(2).max(100),
});

export const changeRoleSchema = z.object({
  role: z.enum(USER_ROLES),
  reason: moderationReason,
});

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(50),
  cursor: z.uuid().optional(),
  actorId: z.uuid().optional(),
  targetId: z.uuid().optional(),
});

export interface ReportContextMessage {
  senderId: string;
  body: string;
  createdAt: string;
}

export interface ReportView {
  id: string;
  status: ReportStatus;
  reason: (typeof REPORT_REASONS)[number];
  details: string | null;
  reporter: UserCard | null;
  reported: UserCard | null;
  reportedUserId: string;
  reporterId: string;
  messageId: string | null;
  /** Text of the reported message as it was when reported (later edits/deletes cannot change it). */
  messageSnapshot: string | null;
  context: ReportContextMessage[] | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  username: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserSummary {
  emailVerified: boolean;
  avatarId: string | null;
  reportsAgainst: number;
  openReportsAgainst: number;
  reportsMade: number;
  friendCount: number;
  recentActions: {
    id: string;
    type: 'SUSPEND' | 'BAN' | 'REINSTATE';
    reason: string;
    moderatorId: string;
    createdAt: string;
  }[];
}

export interface AuditLogView {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

export type ReportPage = Page<ReportView>;
