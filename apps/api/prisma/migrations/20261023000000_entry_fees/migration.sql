-- Slice 8B: entry fees in bonus coins (decision #110). 0 means a free match.

ALTER TABLE "game_matches" ADD COLUMN "entryFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "game_matches" ADD CONSTRAINT "game_matches_entryFee_nonnegative" CHECK ("entryFee" >= 0);

ALTER TABLE "game_rooms" ADD COLUMN "entryFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "game_rooms" ADD CONSTRAINT "game_rooms_entryFee_nonnegative" CHECK ("entryFee" >= 0);

ALTER TABLE "match_queue_entries" ADD COLUMN "entryFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "match_queue_entries" ADD CONSTRAINT "match_queue_entries_entryFee_nonnegative" CHECK ("entryFee" >= 0);

-- Master switch (1 = players may start paid matches, 0 = every new match is free).
INSERT INTO "coin_settings" ("key", "value") VALUES ('paidEntry', 1) ON CONFLICT ("key") DO NOTHING;
