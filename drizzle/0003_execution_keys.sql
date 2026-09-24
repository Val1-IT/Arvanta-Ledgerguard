CREATE TABLE "ledgerguard_execution_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"plan_version" integer NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"result_json" text
);
