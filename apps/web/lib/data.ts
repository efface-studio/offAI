import "server-only";
import { DEFAULT_ORG, type Org, type Report, type Stage, type TaskStatus } from "@offai/core";
import { and, desc, eq, gte, inArray, loadOrg, monthlySpendByDivision, schema, sql } from "@offai/db";
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

// 하위 쿼리 안에서 tasks.id 를 명시해야 runs.id 로 잘못 해석되지 않는다
const spentSql = sql<number>`coalesce((select sum(r.cost_cents) from runs r where r.task_id = "tasks"."id"), 0)::int`;

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

export type ReportItem = {
  id: string;
  taskId: string;
  taskTitle: string;
  issueNumber: number | null;
  level: "member" | "team" | "division";
  stage: Stage;
  divisionId: string;
  teamId: string | null;
  roleId: string | null;
  outcome: Report["outcome"];
  summary: string;
  body: string;
  nextTeamId: string | null;
  nextHuman: string | null;
  createdAt: Date;
};

const reportColumns = {
  id: schema.reports.id,
  taskId: schema.reports.taskId,
  taskTitle: schema.tasks.title,
  issueNumber: schema.tasks.issueNumber,
  level: schema.reports.level,
  stage: schema.reports.stage,
  divisionId: schema.reports.divisionId,
  teamId: schema.reports.teamId,
  roleId: schema.reports.roleId,
  outcome: schema.reports.outcome,
  summary: schema.reports.summary,
  body: schema.reports.body,
  nextTeamId: schema.reports.nextTeamId,
  nextHuman: schema.reports.nextHuman,
  createdAt: schema.reports.createdAt,
};

export async function getRecentReports(limit = 100, filter: { divisionId?: string; teamId?: string } = {}): Promise<ReportItem[]> {
  const db = getDb();
  if (!db) return [];
  const conditions = [
    filter.divisionId ? eq(schema.reports.divisionId, filter.divisionId) : undefined,
    filter.teamId ? eq(schema.reports.teamId, filter.teamId) : undefined,
  ].filter((item) => item !== undefined);
  return db
    .select(reportColumns)
    .from(schema.reports)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.reports.taskId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.reports.createdAt))
    .limit(limit);
}

export async function getTaskReports(taskId: string): Promise<ReportItem[]> {
  const db = getDb();
  if (!db || !/^[0-9a-f-]{36}$/i.test(taskId)) return [];
  return db
    .select(reportColumns)
    .from(schema.reports)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.reports.taskId))
    .where(eq(schema.reports.taskId, taskId))
    .orderBy(schema.reports.createdAt);
}

export type DivisionWeek = {
  sessions: number;
  costCents: number;
  completed: number;
  changesRequested: number;
  blocked: number;
  latest: ReportItem | null;
};

/** 최근 7일 본부별 현황 */
export async function getDivisionWeek(now = new Date()): Promise<Map<string, DivisionWeek>> {
  const db = getDb();
  const result = new Map<string, DivisionWeek>();
  if (!db) return result;
  const since = new Date(now.getTime() - 7 * 24 * 3_600_000);
  const empty = (): DivisionWeek => ({ sessions: 0, costCents: 0, completed: 0, changesRequested: 0, blocked: 0, latest: null });

  const runs = await db
    .select({ divisionId: schema.runs.divisionId, sessions: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${schema.runs.costCents}), 0)::int` })
    .from(schema.runs)
    .where(gte(schema.runs.startedAt, since))
    .groupBy(schema.runs.divisionId);
  for (const row of runs) result.set(row.divisionId, { ...empty(), sessions: row.sessions, costCents: row.cost });

  const outcomes = await db
    .select({ divisionId: schema.reports.divisionId, outcome: schema.reports.outcome, count: sql<number>`count(*)::int` })
    .from(schema.reports)
    .where(and(eq(schema.reports.level, "team"), gte(schema.reports.createdAt, since)))
    .groupBy(schema.reports.divisionId, schema.reports.outcome);
  for (const row of outcomes) {
    const week = result.get(row.divisionId) ?? empty();
    if (row.outcome === "completed") week.completed += row.count;
    else if (row.outcome === "changes_requested") week.changesRequested += row.count;
    else week.blocked += row.count;
    result.set(row.divisionId, week);
  }

  const latest = await db
    .selectDistinctOn([schema.reports.divisionId], reportColumns)
    .from(schema.reports)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.reports.taskId))
    .where(and(eq(schema.reports.level, "division"), gte(schema.reports.createdAt, since)))
    .orderBy(schema.reports.divisionId, desc(schema.reports.createdAt));
  for (const row of latest) {
    const week = result.get(row.divisionId) ?? empty();
    week.latest = row;
    result.set(row.divisionId, week);
  }
  return result;
}


export type ActivityItem = {
  id: number;
  runId: string | null;
  teamId: string;
  kind: schema.ActivityKind;
  actorRoleId: string | null;
  targetRoleId: string | null;
  detail: string;
  createdAt: Date;
};

export async function getTaskActivities(taskId: string): Promise<ActivityItem[]> {
  const db = getDb();
  if (!db || !/^[0-9a-f-]{36}$/i.test(taskId)) return [];
  const rows = await db
    .select()
    .from(schema.activities)
    .where(eq(schema.activities.taskId, taskId))
    .orderBy(desc(schema.activities.id))
    .limit(500);
  return rows.reverse();
}

export type MemberState = { state: "working" | "reported" | "idle"; detail: string; taskId: string; at: Date };

/**
 * 실행 중인 세션의 직원별 현재 상태 (자리 배치도·작업 상세용)
 * - working: 투입·지시 이후 아직 보고 전, 또는 최근 명령 실행
 * - reported: 팀장에게 보고 완료
 */
export async function getMemberStates(): Promise<Map<string, MemberState>> {
  const db = getDb();
  const states = new Map<string, MemberState>();
  if (!db) return states;
  const rows = await db
    .select({
      taskId: schema.activities.taskId,
      kind: schema.activities.kind,
      actor: schema.activities.actorRoleId,
      target: schema.activities.targetRoleId,
      detail: schema.activities.detail,
      createdAt: schema.activities.createdAt,
    })
    .from(schema.activities)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.activities.runId))
    .where(eq(schema.runs.status, "running"))
    .orderBy(schema.activities.id);
  for (const row of rows) {
    if (row.kind === "delegated" && row.target) {
      states.set(row.target, { state: "working", detail: `지시받음: ${row.detail}`, taskId: row.taskId, at: row.createdAt });
    }
    if (!row.actor) continue;
    const reported = row.kind === "member_report";
    states.set(row.actor, { state: reported ? "reported" : "working", detail: reported ? `보고: ${row.detail}` : row.detail, taskId: row.taskId, at: row.createdAt });
  }
  return states;
}

export type ProjectTask = TaskSummary & { lastActivity: { detail: string; actorRoleId: string | null; at: Date } | null };

/** 프로젝트(레포)별 진행 중 작업과 최근 활동 */
export async function getProjects(repos: readonly string[]): Promise<{ repo: string; active: ProjectTask[]; doneCount: number }[]> {
  const db = getDb();
  if (!db) return repos.map((repo) => ({ repo, active: [], doneCount: 0 }));
  const tasks = await getTasks();
  const latest = await db
    .selectDistinctOn([schema.activities.taskId], {
      taskId: schema.activities.taskId,
      detail: schema.activities.detail,
      actorRoleId: schema.activities.actorRoleId,
      at: schema.activities.createdAt,
    })
    .from(schema.activities)
    .orderBy(schema.activities.taskId, desc(schema.activities.id));
  const byTask = new Map(latest.map((row) => [row.taskId, { detail: row.detail, actorRoleId: row.actorRoleId, at: row.at }]));
  const allRepos = [...new Set([...repos, ...tasks.map((task) => task.repo)])];
  return allRepos.map((repo) => {
    const mine = tasks.filter((task) => task.repo === repo);
    return {
      repo,
      active: mine.filter((task) => task.status !== "done").map((task) => ({ ...task, lastActivity: byTask.get(task.id) ?? null })),
      doneCount: mine.filter((task) => task.status === "done").length,
    };
  });
}

export type ExecutiveDigest = {
  running: number;
  awaitingMerge: number;
  awaitingDeploy: number;
  escalated: number;
  approvals: number;
  divisionToday: ReportItem[];
};

/** 대표 보고: 사람이 처리할 일과 본부별 최근 24시간 보고 */
export async function getExecutiveDigest(now = new Date()): Promise<ExecutiveDigest> {
  const db = getDb();
  const empty: ExecutiveDigest = { running: 0, awaitingMerge: 0, awaitingDeploy: 0, escalated: 0, approvals: 0, divisionToday: [] };
  if (!db) return empty;
  const counts = await db
    .select({ status: schema.tasks.status, count: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .groupBy(schema.tasks.status);
  const count = (status: TaskStatus) => counts.find((row) => row.status === status)?.count ?? 0;
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const divisionToday = await db
    .selectDistinctOn([schema.reports.divisionId], reportColumns)
    .from(schema.reports)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.reports.taskId))
    .where(and(eq(schema.reports.level, "division"), gte(schema.reports.createdAt, since)))
    .orderBy(schema.reports.divisionId, desc(schema.reports.createdAt));
  return {
    running: count("running") + count("queued"),
    awaitingMerge: count("awaiting_merge"),
    awaitingDeploy: count("awaiting_deploy"),
    escalated: count("escalated"),
    approvals: (await getPendingApprovalCount()) || count("awaiting_approval"),
    divisionToday,
  };
}
