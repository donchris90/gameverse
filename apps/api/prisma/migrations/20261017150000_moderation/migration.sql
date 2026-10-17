-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('HARASSMENT', 'HATE', 'SEXUAL_CONTENT', 'SPAM', 'IMPERSONATION', 'UNDERAGE', 'CHEATING', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('SUSPEND', 'BAN', 'REINSTATE');

-- CreateTable
CREATE TABLE "moderation_reports" (
    "id" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reportedUserId" UUID NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" VARCHAR(500),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "messageId" UUID,
    "messageSnapshot" VARCHAR(2000),
    "contextSnapshot" JSONB,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" UUID,
    "resolutionNote" VARCHAR(500),

    CONSTRAINT "moderation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" UUID NOT NULL,
    "moderatorId" UUID NOT NULL,
    "targetUserId" UUID NOT NULL,
    "type" "ModerationActionType" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "reportId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "moderation_reports_dedupeKey_key" ON "moderation_reports"("dedupeKey");

-- CreateIndex
CREATE INDEX "moderation_reports_status_id_idx" ON "moderation_reports"("status", "id");

-- CreateIndex
CREATE INDEX "moderation_reports_reportedUserId_idx" ON "moderation_reports"("reportedUserId");

-- CreateIndex
CREATE INDEX "moderation_reports_reporterId_createdAt_idx" ON "moderation_reports"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_actions_targetUserId_createdAt_idx" ON "moderation_actions"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetId_id_idx" ON "audit_logs"("targetId", "id");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_id_idx" ON "audit_logs"("actorId", "id");

-- AddForeignKey
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added integrity rules Prisma cannot express (keep when regenerating migrations).
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_not_self_check" CHECK ("reporterId" <> "reportedUserId");

-- The audit log is append-only: reject UPDATE and DELETE at the database level. (TRUNCATE is
-- deliberately not blocked here: it needs table ownership and is used to reset test databases.)
CREATE FUNCTION "audit_logs_reject_change"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_update_delete"
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "audit_logs_reject_change"();
