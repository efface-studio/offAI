"use server";

import { ASSIGNMENTS, EFFORTS, GENDERS, MODEL_IDS, RANKS, RANK_DEFAULTS, STAGES, TOOL_PROFILES, orgSchema, type Org, type Role } from "@offai/core";
import { InvalidTransitionError } from "@offai/core";
import { and, applyTaskEvent, eq, loadOrg, saveOrg, schema } from "@offai/db";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, checkPassword, gateMode, isValidSession, sessionToken } from "@/lib/auth";
import { requireDb } from "@/lib/db";

const ACTOR = "console";

async function assertAdmin(): Promise<void> {
  const mode = gateMode();
  if (mode === "open") return;
  const store = await cookies();
  if (mode === "locked" || !(await isValidSession(store.get(SESSION_COOKIE)?.value))) redirect("/login");
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function oneOf<T extends string>(values: readonly T[], value: string, label: string): T {
  if ((values as readonly string[]).includes(value)) return value as T;
  throw new Error(`${label} 값이 올바르지 않습니다`);
}

function dollarsToCents(value: string, label: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${label}은 0보다 큰 금액이어야 합니다`);
  return Math.round(amount * 100);
}

function years(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 50) throw new Error(`${label} 경력은 0~50 사이 정수여야 합니다`);
  return n;
}

/** 폼에서 인물 정보를 읽는다. prefix 가 있으면 `${prefix}.` 를 붙인다. */
function personFrom(form: FormData, prefix: string, label: string) {
  const key = (name: string) => (prefix ? `${prefix}.${name}` : name);
  return {
    name: field(form, key("personName")),
    gender: oneOf(GENDERS, field(form, key("gender")), `${label} 성별`),
    years: years(field(form, key("years")), label),
    background: field(form, key("background")),
  };
}

function lines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 조직을 수정해 새 버전으로 저장한다. 검증 오류는 메시지와 함께 돌려보낸다. */
async function editOrg(back: string, mutate: (org: Org) => void): Promise<never> {
  await assertAdmin();
  const db = requireDb();
  let message: string | null = null;
  try {
    const { org } = await loadOrg(db);
    const draft = structuredClone(org);
    mutate(draft);
    const parsed = orgSchema.safeParse(draft);
    if (!parsed.success) {
      message = parsed.error.issues.map((issue) => issue.message).join(" / ");
    } else {
      await saveOrg(db, parsed.data, ACTOR);
    }
  } catch (error) {
    message = error instanceof Error ? error.message : "저장하지 못했습니다";
  }
  revalidatePath("/", "layout");
  redirect(message ? `${back}?error=${encodeURIComponent(message)}` : `${back}?saved=1`);
}

function findTeamIn(org: Org, teamId: string) {
  for (const division of org.divisions) {
    const team = division.teams.find((item) => item.id === teamId);
    if (team) return { division, team };
  }
  throw new Error("팀을 찾을 수 없습니다");
}

// ───────────────────────── 로그인 ─────────────────────────

export async function login(form: FormData): Promise<void> {
  const password = field(form, "password");
  if (gateMode() !== "password" || !(await checkPassword(password))) {
    redirect("/login?error=1");
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

// ───────────────────────── 조직 ─────────────────────────

export async function updateTeam(form: FormData): Promise<void> {
  const teamId = field(form, "teamId");
  await editOrg(`/teams/${teamId}`, (org) => {
    const { team } = findTeamIn(org, teamId);
    team.name = field(form, "name");
    team.domain = field(form, "domain");
    team.assignment = oneOf(ASSIGNMENTS, field(form, "assignment"), "참여 방식");
    team.labels = lines(field(form, "labels"));
    team.triggerPaths = lines(field(form, "triggerPaths"));
    team.sessionBudgetCents = dollarsToCents(field(form, "sessionBudget"), "세션 상한");
    team.roles = team.roles.map((role) => ({
      ...role,
      name: field(form, `role.${role.id}.name`),
      rank: oneOf(RANKS, field(form, `role.${role.id}.rank`), "직급"),
      person: personFrom(form, `role.${role.id}`, role.person.name),
      responsibility: field(form, `role.${role.id}.responsibility`),
      instructions: field(form, `role.${role.id}.instructions`),
      model: oneOf(MODEL_IDS, field(form, `role.${role.id}.model`), "모델"),
      effort: oneOf(EFFORTS, field(form, `role.${role.id}.effort`), "effort"),
      tools: oneOf(TOOL_PROFILES, field(form, `role.${role.id}.tools`), "도구"),
    }));
  });
}

export async function addRole(form: FormData): Promise<void> {
  const teamId = field(form, "teamId");
  await editOrg(`/teams/${teamId}`, (org) => {
    const { team } = findTeamIn(org, teamId);
    const id = field(form, "id");
    if (org.divisions.some((division) => division.teams.some((item) => item.roles.some((role) => role.id === id)))) {
      throw new Error(`역할 ID가 이미 있습니다: ${id}`);
    }
    const rank = oneOf(RANKS, field(form, "rank"), "직급");
    if (rank === "팀장") throw new Error("팀장은 팀마다 한 명입니다. 다른 직급으로 추가하세요");
    const role: Role = {
      id,
      name: field(form, "name"),
      rank,
      person: personFrom(form, "", "새 직원"),
      responsibility: field(form, "responsibility"),
      instructions: field(form, "instructions"),
      model: oneOf(MODEL_IDS, field(form, "model"), "모델"),
      effort: oneOf(EFFORTS, field(form, "effort"), "effort"),
      tools: oneOf(TOOL_PROFILES, field(form, "tools"), "도구"),
    };
    team.roles.push(role);
  });
}

export async function removeRole(form: FormData): Promise<void> {
  const teamId = field(form, "teamId");
  const roleId = field(form, "roleId");
  await editOrg(`/teams/${teamId}`, (org) => {
    const { team } = findTeamIn(org, teamId);
    const role = team.roles.find((item) => item.id === roleId);
    if (!role) throw new Error("역할을 찾을 수 없습니다");
    if (role.rank === "팀장") throw new Error("팀장은 내보낼 수 없습니다");
    team.roles = team.roles.filter((item) => item.id !== roleId);
  });
}

export async function updateSettings(form: FormData): Promise<void> {
  await editOrg("/settings", (org) => {
    org.repos = lines(field(form, "repos"));
    const maxReworks = Number(field(form, "maxReworks"));
    if (!Number.isInteger(maxReworks)) throw new Error("재구현 한도는 정수여야 합니다");
    org.maxReworks = maxReworks;
    for (const division of org.divisions) {
      division.name = field(form, `division.${division.id}.name`);
      division.mission = field(form, `division.${division.id}.mission`);
      division.head = {
        name: field(form, `division.${division.id}.headName`),
        gender: oneOf(GENDERS, field(form, `division.${division.id}.headGender`), "본부장 성별"),
        years: years(field(form, `division.${division.id}.headYears`), "본부장"),
        background: division.head.background,
      };
      division.monthlyBudgetCents = dollarsToCents(field(form, `division.${division.id}.budget`), `${division.name} 월 예산`);
    }
  });
}

export async function addTeam(form: FormData): Promise<void> {
  await editOrg("/settings", (org) => {
    const division = org.divisions.find((item) => item.id === field(form, "divisionId"));
    if (!division) throw new Error("본부를 찾을 수 없습니다");
    const id = field(form, "id");
    const name = field(form, "name");
    division.teams.push({
      id,
      name,
      stage: oneOf(STAGES, field(form, "stage"), "단계"),
      domain: field(form, "domain"),
      assignment: oneOf(ASSIGNMENTS, field(form, "assignment"), "참여 방식"),
      labels: lines(field(form, "labels")),
      triggerPaths: [],
      sessionBudgetCents: 500,
      roles: [
        {
          id: `${id}-lead`,
          name: `${name} 리드`,
          rank: "팀장",
          person: { name: field(form, "leadName"), gender: oneOf(GENDERS, field(form, "leadGender"), "팀장 성별"), years: 20, background: "" },
          responsibility: "작업 계획, 위임, 결과 보고",
          instructions: `너는 ${name} 팀장이다. 브리프의 할 일을 수행하고 report_result 로 보고한다.`,
          ...RANK_DEFAULTS.팀장,
          tools: "full",
        },
      ],
    });
  });
}

export async function removeTeam(form: FormData): Promise<void> {
  const teamId = field(form, "teamId");
  await editOrg("/settings", (org) => {
    const { division, team } = findTeamIn(org, teamId);
    const primaries = org.divisions.flatMap((item) => item.teams).filter((item) => item.stage === team.stage && item.assignment === "primary");
    if (team.assignment === "primary" && primaries.length <= 1) throw new Error(`${team.name}은 이 단계를 맡는 마지막 주 담당 팀이라 삭제할 수 없습니다`);
    if (division.teams.length <= 1) throw new Error("본부에는 팀이 하나 이상 있어야 합니다");
    division.teams = division.teams.filter((item) => item.id !== teamId);
  });
}

// ───────────────────────── 작업 ─────────────────────────

export async function decideApproval(form: FormData): Promise<void> {
  await assertAdmin();
  const db = requireDb();
  const id = field(form, "id");
  const decision = field(form, "decision") === "allow" ? "allowed" : "denied";
  await db
    .update(schema.approvals)
    .set({ status: decision, decidedBy: ACTOR, decidedAt: new Date() })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, "pending")));
  revalidatePath("/", "layout");
  redirect("/approvals?saved=1");
}

async function taskEvent(form: FormData, event: Parameters<typeof applyTaskEvent>[2], message: string): Promise<void> {
  await assertAdmin();
  const db = requireDb();
  const taskId = field(form, "taskId");
  let error: string | null = null;
  try {
    await applyTaskEvent(db, taskId, event, ACTOR, message);
  } catch (caught) {
    error = caught instanceof InvalidTransitionError ? "현재 상태에서는 할 수 없는 작업입니다" : "처리하지 못했습니다";
  }
  revalidatePath("/", "layout");
  redirect(`/tasks/${taskId}?${error ? `error=${encodeURIComponent(error)}` : "saved=1"}`);
}

export async function approveDeploy(form: FormData): Promise<void> {
  await taskEvent(form, { type: "deploy_approved" }, "production 배포 승인 기록");
}

export async function retryTask(form: FormData): Promise<void> {
  await taskEvent(form, { type: "retry" }, "다시 시도");
}
