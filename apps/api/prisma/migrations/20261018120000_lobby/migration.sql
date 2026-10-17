-- Slice 2C: private rooms / friend invites and the quick-match queue.

CREATE TYPE "RoomStatus" AS ENUM ('OPEN', 'STARTED', 'CLOSED', 'DECLINED', 'EXPIRED');

CREATE TABLE "game_rooms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "hostId" UUID NOT NULL,
    "invitedUserId" UUID,
    "status" "RoomStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "matchId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ(3),
    CONSTRAINT "game_rooms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_rooms_code_key" ON "game_rooms"("code");
CREATE UNIQUE INDEX "game_rooms_matchId_key" ON "game_rooms"("matchId");
CREATE INDEX "game_rooms_hostId_status_idx" ON "game_rooms"("hostId", "status");
CREATE INDEX "game_rooms_invitedUserId_status_idx" ON "game_rooms"("invitedUserId", "status");
CREATE INDEX "game_rooms_status_expiresAt_idx" ON "game_rooms"("status", "expiresAt");

ALTER TABLE "game_rooms" ADD CONSTRAINT "game_rooms_hostId_fkey"
  FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_rooms" ADD CONSTRAINT "game_rooms_invitedUserId_fkey"
  FOREIGN KEY ("invitedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "match_queue_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "match_queue_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "match_queue_entries_userId_key" ON "match_queue_entries"("userId");
CREATE INDEX "match_queue_entries_gameId_joinedAt_idx" ON "match_queue_entries"("gameId", "joinedAt");

ALTER TABLE "match_queue_entries" ADD CONSTRAINT "match_queue_entries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
