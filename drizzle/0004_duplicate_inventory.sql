CREATE TABLE IF NOT EXISTS "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"vendor_name" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "source_receipt_id" text;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "event_identity" text;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "reverses_id" text;
