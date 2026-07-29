CREATE TYPE "public"."entry_kind" AS ENUM('observation', 'question', 'note', 'teaching');--> statement-breakpoint
CREATE TYPE "public"."stage_side" AS ENUM('ascent', 'peak', 'descent');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "daily_logs" (
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"chapter" text,
	"read" boolean DEFAULT false NOT NULL,
	"observe" boolean DEFAULT false NOT NULL,
	"link" boolean DEFAULT false NOT NULL,
	"ask" boolean DEFAULT false NOT NULL,
	"pray" boolean DEFAULT false NOT NULL,
	"sentence" text DEFAULT '' NOT NULL,
	"carrying" text DEFAULT '' NOT NULL,
	"prayer" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_logs_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" "entry_kind" NOT NULL,
	"body" text NOT NULL,
	"chapter" text NOT NULL,
	"verse" text,
	"answered_at" timestamp with time zone,
	"ink_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entry_threads" (
	"entry_id" text NOT NULL,
	"user_id" text NOT NULL,
	"thread_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_threads_entry_id_thread_slug_pk" PRIMARY KEY("entry_id","thread_slug")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"slug" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"chapters" text[] DEFAULT '{}' NOT NULL,
	"thread_slugs" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "people_user_id_slug_pk" PRIMARY KEY("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"user_id" text NOT NULL,
	"chapter" text NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reading_progress_user_id_chapter_pk" PRIMARY KEY("user_id","chapter")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"slug" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"stage" integer NOT NULL,
	"side" "stage_side" NOT NULL,
	"mirror" text,
	"chapters" text[] DEFAULT '{}' NOT NULL,
	"summary" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_receipts" (
	"op_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb,
	"client_updated_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"slug" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"definition" text DEFAULT '' NOT NULL,
	"seeing" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "threads_user_id_slug_pk" PRIMARY KEY("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_threads" ADD CONSTRAINT "entry_threads_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_threads" ADD CONSTRAINT "entry_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_receipts" ADD CONSTRAINT "sync_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entries_user_updated_idx" ON "entries" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "entries_user_chapter_idx" ON "entries" USING btree ("user_id","chapter");--> statement-breakpoint
CREATE INDEX "entries_user_kind_idx" ON "entries" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "entry_threads_thread_idx" ON "entry_threads" USING btree ("user_id","thread_slug");--> statement-breakpoint
CREATE INDEX "reading_progress_user_read_idx" ON "reading_progress" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stages_stage_idx" ON "stages" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "sync_receipts_user_accepted_idx" ON "sync_receipts" USING btree ("user_id","accepted_at");--> statement-breakpoint
CREATE INDEX "threads_user_updated_idx" ON "threads" USING btree ("user_id","updated_at");