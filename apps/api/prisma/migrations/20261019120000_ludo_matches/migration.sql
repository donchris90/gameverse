-- Phase 4: Ludo matches (2-4 seats). The game stays disabled until it is playable end to end.

ALTER TABLE "game_match_players" ADD COLUMN "outAt" TIMESTAMPTZ(3);

INSERT INTO "games" ("id", "name", "enabled", "minPlayers", "maxPlayers") VALUES ('ludo', 'Ludo', false, 2, 4);
