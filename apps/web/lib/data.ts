import "server-only";
import { DEFAULT_ORG, type Org, type Report, type Stage, type TaskStatus } from "@offai/core";
import { desc, eq, inArray, loadOrg, monthlySpendByDivision, schema, sql } from "@offai/db";
import { getDb } from "./db";

export type TaskSummary = {
  id: string;
  repo: string;
  issueNumber: number | null;
  title: string;
  stage: Stage;
  status: TaskStatus;
  teamId: string | null;
  prNumber: number | null;
  reworks: number;
  reason: string | null;
  spentCents: number;
  updatedAt: Date;
};

export type ApprovalSummary = {
  id: string;
  taskId: string;
  taskTitle: string;
  repo: string;
  issueNumber: number | null;
  command: string;
  reason: string;
  requestedAt: Date;
};

export type RunSummary = {
  id: string;
  stage: Stage;
  teamId: string;
  sessionId: string | null;
  status: "running" | "completed" | "failed";
  budgetCents: number;
  costCents: number;
  report: Report | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type TaskDetail = TaskSummary & {
  body: string;
  branch: string | null;
  labels: string[];
  findings: string[];
  createdAt: Date;
  runs: RunSummary[];
  events: { id: number; actor: string; message: string; createdAt: Date }[];
};

export function isPreview(): boolean {
  return getDb() === null;
}

export async function getOrgWithVersion(): Promise<{ org: Org; version: number }> {
  const db = getDb();
  if (!db) return { org: DEFAULT_ORG, version: 0 };
  return loadOrg(db);
}

export async function getOrg(): Promise<Org> {
  return (await getOrgWithVersion()).org;
}

const spentSql = sql<number>`coalesce((select sum(${schema.runs.costCents}) from ${schema.runs} where ${schema.runs.taskId} = ${schema.tasks.id}), 0)::int`;

export async function getTasks(): Promise<TaskSummary[]> {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      id: schema.tasks.id,
      repo: schema.tasks.repo,
      issueNumber: schema.tasks.issueNumber,
      title: schema.tasks.title,
      stage: schema.tasks.stage,
      status: schema.tasks.status,
      teamId: schema.tasks.teamId,
      prNumber: schema.tasks.prNumber,
      reworks: schema.tasks.reworks,
      reason: schema.tasks.reason,
      spentCents: spentSql,
      updatedAt: schema.tasks.updatedAt,
    })
    .from(schema.tasks)
    .orderBy(desc(schema.tasks.updatedAt))
    .limit(200);
}

export async function getTask(id: string): Promise<TaskDetail | null> {
  const db = getDb();
  if (!db || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  if (!task) return null;
  const [runs, events] = await Promise.all([
    db.select().from(schema.runs).where(eq(schema.runs.taskId, id)).orderBy(schema.runs.startedAt),
    db.select().from(schema.taskEvents).where(eq(schema.taskEvents.taskId, id)).orderBy(desc(schema.taskEvents.id)).limit(200),
  ]);
  return {
    ...task,
    spentCents: runs.reduce((sum, run) => sum + run.costCents, 0),
    runs,
    events,
  };
}

export async function getPendingApprovals(): Promise<ApprovalSummary[]> {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      id: schema.approvals.id,
      taskId: schema.approvals.taskId,
      taskTitle: schema.tasks.title,
      repo: schema.tasks.repo,
      issueNumber: schema.tasks.issueNumber,
      command: schema.approvals.command,
      reason: schema.approvals.reason,
      requestedAt: schema.approvals.createdAt,
    })
    .from(schema.approvals)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.approvals.taskId))
    .where(eq(schema.approvals.status, "pending"))
    .orderBy(schema.approvals.createdAt);
}

export async function getPendingApprovalCount(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.approvals)
    .where(eq(schema.approvals.status, "pending"));
  return row?.count ?? 0;
}

export async function getMonthlySpend(): Promise<Map<string, number>> {
  const db = getDb();
  if (!db) return new Map();
  return monthlySpendByDivision(db);
}

export type TeamActivity = { state: "working" | "waiting"; taskId: string; taskTitle: string };

/** 팀별 현재 활동 (자리 배치도 표시용) */
export async function getTeamActivity(): Promise<Map<string, TeamActivity>> {
  const db = getDb();
  if (!db) return new Map();
  const rows = await db
    .select({ id: schema.tasks.id, title: schema.tasks.title, teamId: schema.tasks.teamId, status: schema.tasks.status })
    .from(schema.tasks)
    .where(inArray(schema.tasks.status, ["running", "awaiting_approval"]));
  const activity = new Map<string, TeamActivity>();
  for (const row of rows) {
    if (!row.teamId) continue;
    const state = row.status === "running" ? "working" : "waiting";
    if (activity.get(row.teamId)?.state === "working") continue;
    activity.set(row.teamId, { state, taskId: row.id, taskTitle: row.title });
  }
  return activity;
}
