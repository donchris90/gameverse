-- Slice 8D: Ludo seats can be covered by an AI while their player is away. The flag lets the
-- bot sweeper find matches where a human seat needs the AI to move.

ALTER TABLE "game_matches" ADD COLUMN "aiCover" BOOLEAN NOT NULL DEFAULT false;
