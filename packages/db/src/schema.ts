import type { Org, Report, Stage, TaskStatus } from "@offai/core";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** 조직 설정. 수정할 때마다 새 버전 행을 추가하고 가장 큰 version 을 쓴다. */
export const orgVersions = pgTable("org_versions", {
  version: serial("version").primaryKey(),
  config: jsonb("config").$type<Org>().notNull(),
  editedBy: text("edited_by").notNull(),
  createdAt: createdAt(),
});

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repo: text("repo").notNull(),
    /** operate 단계 정기 점검은 Issue 없이 만들어진다 */
    issueNumber: integer("issue_number"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    labels: jsonb("labels").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    stage: text("stage").$type<Stage>().notNull(),
    status: text("status").$type<TaskStatus>().notNull(),
    reworks: integer("reworks").notNull().default(0),
    reason: text("reason"),
    teamId: text("team_id"),
    branch: text("branch"),
    prNumber: integer("pr_number"),
    /** 기획 단계에서 만든 명세 (구현·검증 세션에 전달) */
    spec: text("spec").notNull().default(""),
    /** 검증 단계에서 받은 수정 요청. 재구현 세션에 전달한다. */
    findings: jsonb("findings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tasks_repo_issue_idx").on(table.repo, table.issueNumber),
    index("tasks_status_idx").on(table.status, table.updatedAt),
  ],
);

export const RUN_STATUSES = ["running", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** 팀 세션 1회 실행 기록 */
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    stage: text("stage").$type<Stage>().notNull(),
    divisionId: text("division_id").notNull(),
    teamId: text("team_id").notNull(),
    sessionId: text("session_id"),
    status: text("status").$type<RunStatus>().notNull(),
    budgetCents: integer("budget_cents").notNull(),
    costCents: integer("cost_cents").notNull().default(0),
    report: jsonb("report").$type<Report>(),
    error: text("error"),
    startedAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("runs_task_idx").on(table.taskId), index("runs_division_month_idx").on(table.divisionId, table.startedAt)],
);

export const APPROVAL_STATUSES = ["pending", "allowed", "denied"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** 사람 확인이 필요한 도구 호출 */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    toolUseId: text("tool_use_id").notNull(),
    command: text("command").notNull(),
    reason: text("reason").notNull(),
    status: text("status").$type<ApprovalStatus>().notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("approvals_tool_use_idx").on(table.toolUseId), index("approvals_status_idx").on(table.status)],
);

/** 작업 활동 기록 (화면 타임라인용) */
export const taskEvents = pgTable(
  "task_events",
  {
    id: serial("id").primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("task_events_task_idx").on(table.taskId, table.id)],
);

/** 역할 → Managed Agents agent 매핑 */
export const agents = pgTable("agents", {
  roleId: text("role_id").primaryKey(),
  agentId: text("agent_id").notNull(),
  agentVersion: integer("agent_version").notNull(),
  configHash: text("config_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 단일 값 설정 (Managed Agents environment ID, 동기화된 조직 버전 등) */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const REPORT_LEVELS = ["team", "division"] as const;
export type ReportLevel = (typeof REPORT_LEVELS)[number];

/**
 * 팀·본부 보고. 팀 세션이 끝나면 팀 보고, 단계가 끝나면 참여 본부별 종합 보고를 남긴다.
 * 다음 단계 팀의 브리프에 인계 자료로 들어간다.
 */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    level: text("level").$type<ReportLevel>().notNull(),
    stage: text("stage").$type<Stage>().notNull(),
    divisionId: text("division_id").notNull(),
    /** 본부 보고는 null */
    teamId: text("team_id"),
    outcome: text("outcome").$type<Report["outcome"]>().notNull(),
    summary: text("summary").notNull(),
    /** 인계용 상세 (Markdown) */
    body: text("body").notNull().default(""),
    /** 다음에 일을 넘겨받는 팀 (없으면 사람 또는 종료) */
    nextTeamId: text("next_team_id"),
    /** 다음 담당이 사람일 때 설명 (merge, 배포 등) */
    nextHuman: text("next_human"),
    createdAt: createdAt(),
  },
  (table) => [index("reports_task_idx").on(table.taskId, table.createdAt), index("reports_created_idx").on(table.createdAt)],
);
