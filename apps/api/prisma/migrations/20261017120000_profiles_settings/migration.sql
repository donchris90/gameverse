-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('EVERYONE', 'FRIENDS');

-- CreateEnum
CREATE TYPE "OnlineStatusVisibility" AS ENUM ('EVERYONE', 'FRIENDS', 'NOBODY');

-- CreateEnum
CREATE TYPE "DirectMessagePolicy" AS ENUM ('EVERYONE', 'FRIENDS', 'NOBODY');

-- CreateTable
CREATE TABLE "user_profiles" (
    "userId" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "usernameLower" TEXT NOT NULL,
    "avatarId" TEXT NOT NULL,
    "bio" VARCHAR(160),
    "usernameChangedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "userId" UUID NOT NULL,
    "profileVisibility" "ProfileVisibility" NOT NULL DEFAULT 'FRIENDS',
    "onlineStatusVisibility" "OnlineStatusVisibility" NOT NULL DEFAULT 'FRIENDS',
    "dmPolicy" "DirectMessagePolicy" NOT NULL DEFAULT 'FRIENDS',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_usernameLower_key" ON "user_profiles"("usernameLower");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
