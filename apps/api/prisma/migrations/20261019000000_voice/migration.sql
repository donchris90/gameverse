-- Phase 3: voice usage sessions (metadata only; no audio is stored).

CREATE TABLE "voice_sessions" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "userId" UUID,
    "agoraUid" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL,
    "leftAt" TIMESTAMPTZ(3),
    "endReason" TEXT,
    "seconds" INTEGER,
    CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "voice_sessions_matchId_leftAt_idx" ON "voice_sessions"("matchId", "leftAt");
CREATE INDEX "voice_sessions_userId_joinedAt_idx" ON "voice_sessions"("userId", "joinedAt");
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "game_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
