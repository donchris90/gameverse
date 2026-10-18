-- Slice 8A: bonus coins. A free, non-purchasable, non-withdrawable play currency (decision #110).
-- One balance row per player, an append-only ledger, and admin-editable earning amounts.

CREATE TABLE "coin_wallets" (
    "userId" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coin_wallets_pkey" PRIMARY KEY ("userId"),
    -- A balance can never go below zero, whatever the application does.
    CONSTRAINT "coin_wallets_balance_nonnegative" CHECK ("balance" >= 0)
);
ALTER TABLE "coin_wallets" ADD CONSTRAINT "coin_wallets_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "coin_ledger" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    -- Positive for coins in, negative for coins out. Never zero.
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    -- STARTER, DAILY, LEVEL_UP, ADMIN_GRANT, ADMIN_REVOKE, ENTRY, REFUND, POT.
    "reason" TEXT NOT NULL,
    -- What the entry is about (a match id, a level, a day), for support and audit.
    "reference" TEXT,
    -- One real-world event, one entry: replaying the same event cannot pay twice.
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coin_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "coin_ledger_delta_nonzero" CHECK ("delta" <> 0),
    CONSTRAINT "coin_ledger_balance_nonnegative" CHECK ("balanceAfter" >= 0)
);
CREATE UNIQUE INDEX "coin_ledger_idempotencyKey_key" ON "coin_ledger"("idempotencyKey");
CREATE INDEX "coin_ledger_userId_createdAt_idx" ON "coin_ledger"("userId", "createdAt" DESC);
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "coin_settings" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coin_settings_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "coin_settings_value_nonnegative" CHECK ("value" >= 0)
);
-- Defaults (decision #112). The owner changes these from the admin.
INSERT INTO "coin_settings" ("key", "value") VALUES
  ('starter', 500),
  ('daily', 50),
  ('levelUp', 100);
