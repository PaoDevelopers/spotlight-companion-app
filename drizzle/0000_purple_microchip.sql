CREATE TYPE "public"."checkin_method" AS ENUM('qr', 'pass', 'nfc', 'manual');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('registered', 'competing', 'advanced', 'eliminated', 'finished');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('student', 'teacher', 'admin');--> statement-breakpoint
CREATE TYPE "public"."subject" AS ENUM('physics', 'cs', 'both');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "award_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"award_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"rank" integer NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "awards_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"method" "checkin_method" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkins_event_id_user_id_unique" UNIQUE("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "competition_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"competition_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"team_name" text,
	"status" "entry_status" DEFAULT 'registered' NOT NULL,
	"score" integer,
	"rank" integer,
	"notes" text,
	CONSTRAINT "competition_entries_competition_id_user_id_unique" UNIQUE("competition_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_team" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"subject" "subject" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"venue" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer
);
--> statement-breakpoint
CREATE TABLE "exhibit_owners" (
	"exhibit_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "exhibit_owners_exhibit_id_user_id_unique" UNIQUE("exhibit_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "exhibit_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"exhibit_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exhibit_visits_exhibit_id_user_id_unique" UNIQUE("exhibit_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "exhibits" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"subject" "subject" NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"image_url" text,
	CONSTRAINT "exhibits_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "judge_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"exhibit_id" integer NOT NULL,
	"judge_id" integer NOT NULL,
	"score" integer NOT NULL,
	CONSTRAINT "judge_scores_category_exhibit_id_judge_id_unique" UNIQUE("category","exhibit_id","judge_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"class_name" text,
	"role" "role" DEFAULT 'student' NOT NULL,
	"login_code_hash" text,
	"show_on_leaderboard" boolean DEFAULT false NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"exhibit_id" integer NOT NULL,
	"voter_id" integer NOT NULL,
	CONSTRAINT "votes_category_voter_id_unique" UNIQUE("category","voter_id")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_results" ADD CONSTRAINT "award_results_award_id_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."awards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_results" ADD CONSTRAINT "award_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibit_owners" ADD CONSTRAINT "exhibit_owners_exhibit_id_exhibits_id_fk" FOREIGN KEY ("exhibit_id") REFERENCES "public"."exhibits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibit_owners" ADD CONSTRAINT "exhibit_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibit_visits" ADD CONSTRAINT "exhibit_visits_exhibit_id_exhibits_id_fk" FOREIGN KEY ("exhibit_id") REFERENCES "public"."exhibits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibit_visits" ADD CONSTRAINT "exhibit_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_scores" ADD CONSTRAINT "judge_scores_exhibit_id_exhibits_id_fk" FOREIGN KEY ("exhibit_id") REFERENCES "public"."exhibits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_scores" ADD CONSTRAINT "judge_scores_judge_id_users_id_fk" FOREIGN KEY ("judge_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_exhibit_id_exhibits_id_fk" FOREIGN KEY ("exhibit_id") REFERENCES "public"."exhibits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkins_user_idx" ON "checkins" USING btree ("user_id");