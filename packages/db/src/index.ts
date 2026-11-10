import { DEFAULT_ORG, monthStart, orgSchema, routeTask, transition, type Org, type TaskEvent, type TaskState } from "@offai/core";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(url: string, options: { max?: number } = {}): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { max: options.max ?? 5 });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

/** 최신 조직 설정. 아직 저장된 적이 없으면 기본 조직을 돌려준다. */
export async function loadOrg(db: Db): Promise<{ version: number; org: Org }> {
  const [row] = await db.select().from(schema.orgVersions).orderBy(desc(schema.orgVersions.version)).limit(1);
  if (!row) return { version: 0, org: DEFAULT_ORG };
  return { version: row.version, org: orgSchema.parse(row.config) };
}

export async function saveOrg(db: Db, org: Org, editedBy: string): Promise<number> {
  const parsed = orgSchema.parse(org);
  const [row] = await db.insert(schema.orgVersions).values({ config: parsed, editedBy }).returning({ version: schema.orgVersions.version });
  if (!row) throw new Error("조직 설정을 저장하지 못했습니다");
  return row.version;
}

/** 본부별 이번 달 사용 금액 (센트) */
export async function monthlySpendByDivision(db: Db, now = new Date()): Promise<Map<string, number>> {
  const rows = await db
    .select({ divisionId: schema.runs.divisionId, total: sql<number>`coalesce(sum(${schema.runs.costCents}), 0)::int` })
    .from(schema.runs)
    .where(gte(schema.runs.startedAt, monthStart(now)))
    .groupBy(schema.runs.divisionId);
  return new Map(rows.map((row) => [row.divisionId, row.total]));
}

/**
 * 작업 상태 머신 이벤트를 적용한다 (행 잠금). 단계가 바뀌면 새 단계의 담당 팀으로 다시 배정한다.
 * 잘못된 전이는 InvalidTransitionError 를 던진다.
 */
export async function applyTaskEvent(db: Db, taskId: string, event: TaskEvent, actor: string, message?: string): Promise<TaskState | null> {
  const { org } = await loadOrg(db);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).for("update");
    if (!current) return null;
    const state: TaskState = { stage: current.stage, status: current.status, reworks: current.reworks, reason: current.reason };
    const next = transition(state, event, org.maxReworks);
    const teamId = next.stage !== current.stage ? routeTask(org, { stage: next.stage, labels: current.labels }).team.id : current.teamId;
    await tx.update(schema.tasks).set({ ...next, teamId, updatedAt: new Date() }).where(eq(schema.tasks.id, taskId));
    await tx.insert(schema.taskEvents).values({ taskId, actor, message: message ?? event.type });
    if (next.status === "escalated" && next.reason) {
      await tx.insert(schema.taskEvents).values({ taskId, actor: "offai", message: `사람 확인 필요: ${next.reason}` });
    }
    return next;
  });
}

export async function addTaskEvent(db: Db, taskId: string, actor: string, message: string): Promise<void> {
  await db.insert(schema.taskEvents).values({ taskId, actor, message });
}

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}

export { and, desc, eq, gte, inArray, isNull, sql };
