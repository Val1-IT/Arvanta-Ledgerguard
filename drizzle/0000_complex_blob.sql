CREATE TABLE IF NOT EXISTS "baseline_snapshot" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gross_margin_report" (
	"id" text PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"revenue" numeric(18, 2) NOT NULL,
	"cost_of_goods_sold" numeric(18, 2) NOT NULL,
	"gross_profit" numeric(18, 2) NOT NULL,
	"gross_margin_percentage" numeric(7, 4) NOT NULL,
	"generated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"movement_type" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_name" text NOT NULL,
	"base_quantity" numeric(18, 3) NOT NULL,
	"unit_cost" numeric(18, 2) NOT NULL,
	"total_value" numeric(18, 2) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_valuation" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"quantity_on_hand" numeric(18, 3) NOT NULL,
	"average_cost" numeric(18, 2) NOT NULL,
	"inventory_value" numeric(18, 2) NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "investigation_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" text NOT NULL,
	"root_cause" text,
	"affected_asset_count" integer,
	"affected_record_count" integer,
	"estimated_financial_exposure" numeric(18, 2),
	"confidence" numeric(5, 4),
	"result_json" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"account_code" text NOT NULL,
	"debit" numeric(18, 2) NOT NULL,
	"credit" numeric(18, 2) NOT NULL,
	"posted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledgerguard_incidents" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_type" text NOT NULL,
	"severity" text NOT NULL,
	"status" text NOT NULL,
	"root_asset" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_units" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"unit_name" text NOT NULL,
	"conversion_factor" numeric(12, 4) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"base_unit" text NOT NULL,
	"standard_cost" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "remediation_plans" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" text NOT NULL,
	"status" text NOT NULL,
	"proposed_actions" text,
	"remediation_sql" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_valuation" ADD CONSTRAINT "inventory_valuation_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "investigation_runs" ADD CONSTRAINT "investigation_runs_incident_id_ledgerguard_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."ledgerguard_incidents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "remediation_plans" ADD CONSTRAINT "remediation_plans_incident_id_ledgerguard_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."ledgerguard_incidents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
