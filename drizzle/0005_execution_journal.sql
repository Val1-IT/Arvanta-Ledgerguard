ALTER TABLE "ledgerguard_execution_keys"
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "ledgerguard_execution_journal" (
  "id" text PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL,
  "plan_id" text NOT NULL,
  "plan_version" integer NOT NULL,
  "status" text NOT NULL,
  "source_state_fingerprint" text NOT NULL,
  "receipt_json" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "ledgerguard_execution_journal_key_idx"
  ON "ledgerguard_execution_journal" ("idempotency_key");
