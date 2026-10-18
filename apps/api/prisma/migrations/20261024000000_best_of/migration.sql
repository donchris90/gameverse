-- Slice 8C: tic-tac-toe can be one game or best of three. 3 is the old behaviour and the default.

ALTER TABLE "game_matches" ADD COLUMN "bestOf" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "game_matches" ADD CONSTRAINT "game_matches_bestOf_valid" CHECK ("bestOf" IN (1, 3));

ALTER TABLE "game_rooms" ADD COLUMN "bestOf" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "game_rooms" ADD CONSTRAINT "game_rooms_bestOf_valid" CHECK ("bestOf" IN (1, 3));

ALTER TABLE "match_queue_entries" ADD COLUMN "bestOf" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "match_queue_entries" ADD CONSTRAINT "match_queue_entries_bestOf_valid" CHECK ("bestOf" IN (1, 3));
