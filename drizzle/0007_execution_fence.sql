-- Lease generation (fencing token) per execution key. Starts at 1 on reserve and
-- increases on every re-reservation or lease takeover, so a remote system can
-- reject calls from a superseded worker.
ALTER TABLE "ledgerguard_execution_keys" ADD COLUMN IF NOT EXISTS "fence_generation" integer DEFAULT 1 NOT NULL;
