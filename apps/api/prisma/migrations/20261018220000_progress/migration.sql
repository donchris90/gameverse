-- Slice 2F: match results, ratings, statistics and experience.

CREATE TABLE "game_results" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "kind" "MatchKind" NOT NULL,
    "ranked" BOOLEAN NOT NULL,
    "ratingApplied" BOOLEAN NOT NULL,
    "pairKey" TEXT,
    "endReason" TEXT,
    "winnerSeat" SMALLINT,
    "endedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "game_results_matchId_key" ON "game_results"("matchId");
CREATE INDEX "game_results_pairKey_endedAt_idx" ON "game_results"("pairKey", "endedAt");
CREATE INDEX "game_results_gameId_endedAt_idx" ON "game_results"("gameId", "endedAt");
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "game_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "game_result_players" (
    "resultId" UUID NOT NULL,
    "seat" SMALLINT NOT NULL,
    "userId" UUID,
    "score" DOUBLE PRECISION NOT NULL,
    "ratingBefore" INTEGER,
    "ratingAfter" INTEGER,
    "xp" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "game_result_players_pkey" PRIMARY KEY ("resultId", "seat")
);
CREATE INDEX "game_result_players_userId_idx" ON "game_result_players"("userId");
ALTER TABLE "game_result_players" ADD CONSTRAINT "game_result_players_resultId_fkey"
  FOREIGN KEY ("resultId") REFERENCES "game_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_result_players" ADD CONSTRAINT "game_result_players_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "player_ratings" (
    "userId" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "ratedGames" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "player_ratings_pkey" PRIMARY KEY ("userId", "gameId")
);
CREATE INDEX "player_ratings_gameId_rating_idx" ON "player_ratings"("gameId", "rating" DESC);
ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "player_statistics" (
    "userId" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "winStreak" INTEGER NOT NULL DEFAULT 0,
    "bestWinStreak" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "player_statistics_pkey" PRIMARY KEY ("userId", "gameId")
);
ALTER TABLE "player_statistics" ADD CONSTRAINT "player_statistics_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "player_experience" (
    "userId" UUID NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "player_experience_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "player_experience" ADD CONSTRAINT "player_experience_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
