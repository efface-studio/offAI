CREATE TABLE "agents" (
	"role_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"agent_version" integer NOT NULL,
	"config_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"tool_use_id" text NOT NULL,
	"command" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_versions" (
	"version" serial PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"edited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"division_id" text NOT NULL,
	"team_id" text NOT NULL,
	"session_id" text,
	"status" text NOT NULL,
	"budget_cents" integer NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"report" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo" text NOT NULL,
	"issue_number" integer,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"reworks" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"team_id" text,
	"branch" text,
	"pr_number" integer,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_tool_use_idx" ON "approvals" USING btree ("tool_use_id");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runs_task_idx" ON "runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "runs_division_month_idx" ON "runs" USING btree ("division_id","created_at");--> statement-breakpoint
CREATE INDEX "task_events_task_idx" ON "task_events" USING btree ("task_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_repo_issue_idx" ON "tasks" USING btree ("repo","issue_number");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status","updated_at");