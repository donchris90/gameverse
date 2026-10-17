-- Slice 2D: remember since when a player in an active match has had no connection.
ALTER TABLE "game_match_players" ADD COLUMN "disconnectedAt" TIMESTAMPTZ(3);
