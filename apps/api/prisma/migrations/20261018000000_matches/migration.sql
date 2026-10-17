-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('WAITING', 'READY', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "MatchKind" AS ENUM ('QUICK', 'PRIVATE', 'FRIEND', 'BOT');

-- CreateEnum
CREATE TYPE "MatchDeadlineKind" AS ENUM ('READY', 'TURN', 'NEXT_GAME');

-- CreateEnum
CREATE TYPE "BotLevel" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minPlayers" SMALLINT NOT NULL,
    "maxPlayers" SMALLINT NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_matches" (
    "id" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "kind" "MatchKind" NOT NULL,
    "status" "MatchStatus" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB,
    "deadlineKind" "MatchDeadlineKind",
    "deadlineAt" TIMESTAMPTZ(3),
    "endReason" TEXT,
    "winnerSeat" SMALLINT,
    "openingSeat" SMALLINT NOT NULL DEFAULT 0,
    "rematchRequestedMask" SMALLINT NOT NULL DEFAULT 0,
    "rematchMatchId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "game_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_match_players" (
    "matchId" UUID NOT NULL,
    "seat" SMALLINT NOT NULL,
    "userId" UUID,
    "botLevel" "BotLevel",
    "ready" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "game_match_players_pkey" PRIMARY KEY ("matchId","seat")
);

-- CreateTable
CREATE TABLE "game_events" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "seat" SMALLINT,
    "clientActionId" UUID,
    "data" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_matches_rematchMatchId_key" ON "game_matches"("rematchMatchId");

-- CreateIndex
CREATE INDEX "game_matches_status_deadlineAt_idx" ON "game_matches"("status", "deadlineAt");

-- CreateIndex
CREATE INDEX "game_match_players_userId_idx" ON "game_match_players"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "game_events_matchId_seq_key" ON "game_events"("matchId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "game_events_matchId_seat_clientActionId_key" ON "game_events"("matchId", "seat", "clientActionId");

-- AddForeignKey
ALTER TABLE "game_matches" ADD CONSTRAINT "game_matches_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_matches" ADD CONSTRAINT "game_matches_rematchMatchId_fkey" FOREIGN KEY ("rematchMatchId") REFERENCES "game_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_match_players" ADD CONSTRAINT "game_match_players_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "game_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_match_players" ADD CONSTRAINT "game_match_players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "game_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: the games the server can host (a catalogue row is required by the foreign key).
INSERT INTO "games" ("id", "name", "enabled", "minPlayers", "maxPlayers") VALUES ('tictactoe', 'Tic-tac-toe', true, 2, 2);
