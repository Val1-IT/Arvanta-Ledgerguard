ALTER TABLE "remediation_plans" DROP CONSTRAINT IF EXISTS "remediation_plans_incident_id_ledgerguard_incidents_id_fk";
--> statement-breakpoint
DROP TABLE IF EXISTS "remediation_plans";
--> statement-breakpoint
CREATE TABLE "remediation_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"investigation_id" text NOT NULL,
	"incident_id" text NOT NULL,
	"product_id" text NOT NULL,
	"trigger_asset" text NOT NULL,
	"requested_by" text NOT NULL,
	"state" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"proposed_corrections_json" text NOT NULL,
	"verification_expectations_json" text NOT NULL,
	"approval_action" text,
	"approved_by" text,
	"approval_note" text,
	"approved_at" timestamp with time zone,
	"execution_result_json" text,
	"executed_at" timestamp with time zone,
	"verification_json" text,
	"datahub_writeback_json" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
