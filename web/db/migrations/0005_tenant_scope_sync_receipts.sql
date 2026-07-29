ALTER TABLE "sync_receipts" DROP CONSTRAINT "sync_receipts_pkey";--> statement-breakpoint
ALTER TABLE "sync_receipts" ADD CONSTRAINT "sync_receipts_user_id_op_id_pk" PRIMARY KEY("user_id","op_id");
