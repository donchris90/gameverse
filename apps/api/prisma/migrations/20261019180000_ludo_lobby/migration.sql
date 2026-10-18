-- Ludo lobby: rooms and searches for 2 to 4 players.
ALTER TABLE "game_rooms" ADD COLUMN "seats" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "match_queue_entries" ADD COLUMN "seats" INTEGER NOT NULL DEFAULT 2;

CREATE TABLE "game_room_members" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_room_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_room_members_roomId_userId_key" ON "game_room_members"("roomId", "userId");
CREATE INDEX "game_room_members_userId_idx" ON "game_room_members"("userId");

ALTER TABLE "game_room_members" ADD CONSTRAINT "game_room_members_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "game_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_room_members" ADD CONSTRAINT "game_room_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
