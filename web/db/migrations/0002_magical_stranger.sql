ALTER TABLE "entry_threads" DROP CONSTRAINT "entry_threads_entry_id_entries_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "entries_id_user_idx" ON "entries" USING btree ("id","user_id");
--> statement-breakpoint
ALTER TABLE "entry_threads" ADD CONSTRAINT "entry_threads_user_entry_fk" FOREIGN KEY ("entry_id","user_id") REFERENCES "public"."entries"("id","user_id") ON DELETE cascade ON UPDATE no action;
