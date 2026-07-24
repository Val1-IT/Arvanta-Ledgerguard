ALTER TABLE "investigation_runs" DROP CONSTRAINT IF EXISTS "investigation_runs_incident_id_ledgerguard_incidents_id_fk";
--> statement-breakpoint
ALTER TABLE "investigation_runs" ALTER COLUMN "id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "investigation_runs" ADD COLUMN "product_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "investigation_runs" ADD COLUMN "trigger_asset" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "investigation_runs" ADD COLUMN "requested_by" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "investigation_runs" ADD COLUMN "mode" text NOT NULL DEFAULT 'TEST';
--> statement-breakpoint
ALTER TABLE "investigation_runs" ADD COLUMN "final_state" text NOT NULL DEFAULT 'INCIDENT_RECEIVED';
--> statement-breakpoint
ALTER TABLE "investigation_runs" ADD COLUMN "status" text;
--> statement-breakpoint
ALTER TABLE "investigation_runs" ADD COLUMN "input_json" text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "investigation_runs" ADD COLUMN "output_json" text;
--> statement-breakpoint
ALTER TABLE "investigation_runs" ADD COLUMN "error_json" text;
--> statement-breakpoint
ALTER TABLE "investigation_runs" ADD COLUMN "state_history_json" text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE "investigation_runs" ALTER COLUMN "product_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "investigation_runs" ALTER COLUMN "trigger_asset" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "investigation_runs" ALTER COLUMN "requested_by" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "investigation_runs" ALTER COLUMN "mode" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "investigation_runs" ALTER COLUMN "final_state" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "investigation_runs" ALTER COLUMN "input_json" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "investigation_runs" ALTER COLUMN "state_history_json" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "investigation_runs" DROP COLUMN "root_cause";
--> statement-breakpoint
ALTER TABLE "investigation_runs" DROP COLUMN "affected_asset_count";
--> statement-breakpoint
ALTER TABLE "investigation_runs" DROP COLUMN "affected_record_count";
--> statement-breakpoint
ALTER TABLE "investigation_runs" DROP COLUMN "estimated_financial_exposure";
--> statement-breakpoint
ALTER TABLE "investigation_runs" DROP COLUMN "confidence";
--> statement-breakpoint
ALTER TABLE "investigation_runs" DROP COLUMN "result_json";
