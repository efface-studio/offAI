import type Anthropic from "@anthropic-ai/sdk";
import {
  GITMOJI,
  branchName,
  branchTypeFor,
  checkDivisionBudget,
  evaluateCommand,
  initialState,
  prBody,
  prTitle,
  routeTask,
  teamsForStage,
  transition,
  type Org,
  type Report,
  type TaskEvent,
  type TaskState,
  type TeamRef,
} from "@offai/core";
import { addTaskEvent, applyTaskEvent, getSetting, loadOrg, monthlySpendByDivision, schema, type Db } from "@offai/db";
import { and, eq, gte, isNull } from "@offai/db";
import { leadAgentId, syncAgents } from "./agents";
import { buildBrief } from "./brief";
import type { Config } from "./config";
import type { GitHub } from "./github";

/** 오케스트레이터가 쓰는 GitHub 기능 (테스트에서 대체 가능) */
export type GitHubPort = Pick<
  GitHub,
  "defaultBranch" | "changedFiles" | "branchExists" | "findOpenPr" | "createPr" | "comment" | "createIssue" | "installationToken"
>;
import { runSession, type RunResult, type ToolDecision } from "./runner";
import type { WebhookCommand } from "./webhook";

type Task = typeof schema.tasks.$inferSelect;
type Logger = { info(message: string): void; warn(message: string): void; error(message: string): void };

export const ENVIRONMENT_SETTING = "managed_agents_environment_id";
export const SYNCED_ORG_SETTING = "synced_org_version";
const APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export class Orchestrator {
  private readonly active = new Map<string, Promise<void>>();
  private syncing: Promise<void> | null = null;

  constructor(
    private readonly deps: {
      db: Db;
      anthropic: Anthropic;
      github: GitHubPort;
      config: Config;
      log: Logger;
      /** 테스트에서 세션 실행을 대체한다 */
      runSession?: typeof runSession;
      /** 사람 승인 확인 주기 (기본 5초) */
      approvalPollMs?: number;
    },
  ) {}

  // ───────────────────────── webhook ─────────────────────────

  async handleWebhook(command: WebhookCommand): Promise<void> {
    const { db, log } = this.deps;
    if (command.type === "ignore") return;

    if (command.type === "enqueue") {
      const { org } = await loadOrg(db);
      const team = routeTask(org, { stage: "plan", labels: command.labels });
      const [task] = await db
        .insert(schema.tasks)
        .values({
          repo: command.repo,
          issueNumber: command.issueNumber,
          title: command.title,
          body: command.body,
          labels: command.labels,
          teamId: team.team.id,
          branch: branchName({ issueNumber: command.issueNumber, title: command.title, labels: command.labels }),
          ...initialState(),
        })
        .onConflictDoNothing()
        .returning();
      if (!task) {
        log.info(`이미 접수된 Issue입니다: ${command.repo}#${command.issueNumber}`);
        return;
      }
      await addTaskEvent(db, task.id, "offai", `접수: ${team.division.name} ${team.team.name} 배정`);
      await this.safeComment(task, `offAI가 작업을 접수했습니다. 담당: ${team.division.name} ${team.team.name}`);
      return;
    }

    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.repo, command.repo), eq(schema.tasks.prNumber, command.prNumber)))
      .limit(1);
    if (!task) return;
    await this.apply(task, command.merged ? { type: "pr_merged" } : { type: "pr_closed" }, "github", command.merged ? "PR merge 확인 → 릴리스 대기" : "PR이 merge 없이 닫힘");
  }

  // ───────────────────────── loop ─────────────────────────

  /** 주기적으로 호출된다. 조직 변경을 동기화하고 대기 작업을 시작한다. */
  async tick(): Promise<void> {
    await this.ensureAgentsSynced();
    while (this.active.size < this.deps.config.MAX_CONCURRENCY) {
      const task = await this.claimNext();
      if (!task) break;
      const work = this.process(task)
        .catch(async (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.deps.log.error(`작업 처리 실패 ${task.id}: ${message}`);
          await this.escalate(task.id, `처리 중 오류: ${message}`).catch(() => undefined);
        })
        .finally(() => this.active.delete(task.id));
      this.active.set(task.id, work);
    }
  }

  /** 실행 중인 작업이 모두 끝날 때까지 기다린다 */
  async idle(): Promise<void> {
    while (this.active.size > 0) await Promise.all(this.active.values());
  }

  async ensureAgentsSynced(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      const { db, anthropic, log } = this.deps;
      const { version, org } = await loadOrg(db);
      const synced = await getSetting(db, SYNCED_ORG_SETTING);
      if (synced === String(version)) return;
      await syncAgents(anthropic, db, org, (message) => log.info(`[agents] ${message}`));
      await db
        .insert(schema.settings)
        .values({ key: SYNCED_ORG_SETTING, value: String(version) })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: String(version), updatedAt: new Date() } });
      log.info(`[agents] 조직 v${version} 동기화 완료`);
    })().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  /** 대기 작업 하나를 잠그고 running 으로 바꾼다 */
  private async claimNext(): Promise<Task | null> {
    const { db } = this.deps;
    return db.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.status, "queued"))
        .orderBy(schema.tasks.updatedAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!task) return null;
      const next = transition(stateOf(task), { type: "start" }, 0);
      const [updated] = await tx
        .update(schema.tasks)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(schema.tasks.id, task.id))
        .returning();
      return updated ?? null;
    });
  }

  // ───────────────────────── 실행 ─────────────────────────

  private async process(task: Task): Promise<void> {
    const { db, github } = this.deps;
    const { org } = await loadOrg(db);
    const environmentId = await getSetting(db, ENVIRONMENT_SETTING);
    if (!environmentId) throw new Error("Managed Agents environment 가 없습니다. `pnpm --filter @offai/worker setup:agents` 를 먼저 실행하세요");

    const baseBranch = await github.defaultBranch(task.repo);
    const teams = await this.teamsFor(org, task);

    const results: { ref: TeamRef; result: RunResult }[] = [];
    for (const ref of teams) {
      const result = await this.runTeam(task, ref, environmentId, baseBranch);
      results.push({ ref, result });
      if (!result.ok) break;
    }

    const failed = results.find((item) => !item.result.ok);
    if (failed && !failed.result.ok) {
      await this.escalate(task.id, `${failed.ref.team.name}: ${failed.result.error}`);
      return;
    }
    const reports = results.map((item) => ({ ref: item.ref, report: (item.result as Extract<RunResult, { ok: true }>).report }));
    await this.applyReports(task, reports, baseBranch);
  }

  /** 주 담당 팀 + 조건부 팀 (검증 단계는 PR 변경 파일로 판단) */
  private async teamsFor(org: Org, task: Task): Promise<TeamRef[]> {
    const changedFiles = task.stage === "verify" && task.prNumber !== null ? await this.deps.github.changedFiles(task.repo, task.prNumber) : [];
    return teamsForStage(org, { stage: task.stage, labels: task.labels, changedFiles });
  }

  private async runTeam(task: Task, ref: TeamRef, environmentId: string, baseBranch: string): Promise<RunResult> {
    const { db, anthropic, github, config, log } = this.deps;

    const spend = await monthlySpendByDivision(db);
    const budget = checkDivisionBudget({
      monthlyBudgetCents: ref.division.monthlyBudgetCents,
      spentThisMonthCents: spend.get(ref.division.id) ?? 0,
      sessionBudgetCents: ref.team.sessionBudgetCents,
    });
    if (!budget.ok) return { ok: false, sessionId: null, error: budget.reason, costCents: 0 };

    const [run] = await db
      .insert(schema.runs)
      .values({ taskId: task.id, stage: task.stage, divisionId: ref.division.id, teamId: ref.team.id, status: "running", budgetCents: ref.team.sessionBudgetCents })
      .returning();
    if (!run) throw new Error("실행 기록을 만들지 못했습니다");
    await db.update(schema.tasks).set({ teamId: ref.team.id, updatedAt: new Date() }).where(eq(schema.tasks.id, task.id));
    await addTaskEvent(db, task.id, ref.team.name, `${ref.team.name} 세션 시작`);

    const commitType = branchTypeFor(task.labels);
    const branchReady = task.branch !== null && (await github.branchExists(task.repo, task.branch));
    const checkoutBranch = task.stage === "implement" ? (branchReady && task.branch ? task.branch : baseBranch) : task.stage === "verify" && task.branch ? task.branch : baseBranch;

    const brief = buildBrief({
      stage: task.stage,
      ...(ref.team.assignment === "conditional" ? { reviewer: { teamName: ref.team.name } } : {}),
      spec: task.spec,
      repo: task.repo,
      issueNumber: task.issueNumber,
      title: task.title,
      body: task.body,
      branch: task.branch,
      baseBranch,
      prNumber: task.prNumber,
      findings: task.stage === "implement" ? task.findings : [],
      commitType,
      gitmoji: GITMOJI[commitType],
    });

    const execute = this.deps.runSession ?? runSession;
    const result = await execute(
      anthropic,
      {
        agentId: await leadAgentId(db, ref.team),
        environmentId,
        title: `${ref.team.name} · ${task.repo}${task.issueNumber ? `#${task.issueNumber}` : ""} · ${task.stage}`,
        repo: task.repo,
        repoToken: await github.installationToken(task.repo),
        checkoutBranch,
        brief,
        budgetCents: ref.team.sessionBudgetCents,
        timeoutMs: config.SESSION_TIMEOUT_MINUTES * 60_000,
      },
      {
        onSession: async (sessionId) => {
          await db.update(schema.runs).set({ sessionId }).where(eq(schema.runs.id, run.id));
        },
        onCost: async (costCents) => {
          await db.update(schema.runs).set({ costCents }).where(eq(schema.runs.id, run.id));
        },
        decideTool: (event) => this.decideTool(task.id, run.id, event),
        log: (message) => log.info(`[${ref.team.id}] ${message}`),
      },
    );

    await db
      .update(schema.runs)
      .set({
        status: result.ok ? "completed" : "failed",
        costCents: result.costCents,
        report: result.ok ? result.report : null,
        error: result.ok ? null : result.error,
        finishedAt: new Date(),
      })
      .where(eq(schema.runs.id, run.id));
    await addTaskEvent(db, task.id, ref.team.name, result.ok ? `보고: ${result.report.summary}` : `실패: ${result.error}`);
    return result;
  }

  /**
   * 멈춘 도구 호출 판정. bash 는 명령 정책으로 판정하고, 사람 확인이 필요하면 승인함에 올리고 기다린다.
   */
  private async decideTool(taskId: string, runId: string, event: { id: string; name: string; input: Record<string, unknown> }): Promise<ToolDecision> {
    const { db } = this.deps;
    if (event.name !== "bash") return { result: "deny", message: "offAI 정책상 허용되지 않은 도구 호출입니다" };
    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (!command) return { result: "allow" }; // restart 등 명령이 없는 호출

    const policy = evaluateCommand(command);
    if (policy.decision === "allow") return { result: "allow" };
    if (policy.decision === "deny") {
      await addTaskEvent(db, taskId, "정책", `거부: ${policy.reason} — ${command.slice(0, 200)}`);
      return { result: "deny", message: `offAI 정책: ${policy.reason}. 다른 방법을 쓰거나 report_result 로 blocked 를 보고하세요.` };
    }

    // 화면에 승인 요청이 보일 때는 작업도 이미 '승인 대기'여야 하므로 상태를 먼저 바꾼다
    await this.applyById(taskId, { type: "approval_requested" }, "정책", `사람 확인 요청: ${policy.reason}`);
    const [run] = await db.select({ sessionId: schema.runs.sessionId }).from(schema.runs).where(eq(schema.runs.id, runId));
    const [approval] = await db
      .insert(schema.approvals)
      .values({ taskId, runId, sessionId: run?.sessionId ?? "", toolUseId: event.id, command, reason: policy.reason })
      .onConflictDoNothing()
      .returning();
    const approvalId =
      approval?.id ?? (await db.select({ id: schema.approvals.id }).from(schema.approvals).where(eq(schema.approvals.toolUseId, event.id)))[0]?.id;
    if (!approvalId) {
      await this.applyById(taskId, { type: "approval_resolved" }, "offai", "승인 요청 기록 실패로 거부");
      return { result: "deny", message: "승인 요청을 기록하지 못했습니다" };
    }

    const started = Date.now();
    while (Date.now() - started < APPROVAL_TIMEOUT_MS) {
      const [row] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, approvalId));
      if (row && row.status !== "pending") {
        await this.applyById(taskId, { type: "approval_resolved" }, row.decidedBy ?? "사람", row.status === "allowed" ? "명령 승인" : "명령 거부");
        return row.status === "allowed" ? { result: "allow" } : { result: "deny", message: "사람이 이 명령을 거부했습니다. 다른 방법을 찾거나 blocked 로 보고하세요." };
      }
      await new Promise((resolve) => setTimeout(resolve, this.deps.approvalPollMs ?? 5_000));
    }
    await db.update(schema.approvals).set({ status: "denied", decidedBy: "timeout", decidedAt: new Date() }).where(eq(schema.approvals.id, approvalId));
    await this.applyById(taskId, { type: "approval_resolved" }, "offai", "승인 대기 시간 초과로 거부");
    return { result: "deny", message: "승인 대기 시간이 지나 거부되었습니다" };
  }

  // ───────────────────────── 결과 반영 ─────────────────────────

  private async applyReports(task: Task, reports: { ref: TeamRef; report: Report }[], baseBranch: string): Promise<void> {
    const { github, config } = this.deps;
    const blocked = reports.find((item) => item.report.outcome === "blocked");
    if (blocked) {
      const questions = blocked.report.questions;
      if (questions.length > 0) {
        await this.safeComment(task, `${blocked.ref.team.name}에서 확인이 필요한 질문이 있습니다. Issue에 답을 남긴 뒤 offAI 콘솔에서 다시 시도해 주세요.\n\n${questions.map((q) => `- ${q}`).join("\n")}`);
      }
      await this.escalate(task.id, `${blocked.ref.team.name} 진행 불가: ${blocked.report.summary}`);
      return;
    }

    switch (task.stage) {
      case "plan": {
        const spec = reports
          .filter((item) => item.report.spec.trim())
          .map((item) => `### ${item.ref.team.name}\n\n${item.report.spec.trim()}`)
          .join("\n\n");
        if (!spec) {
          await this.escalate(task.id, "기획 명세가 비어 있습니다");
          return;
        }
        await this.deps.db.update(schema.tasks).set({ spec }).where(eq(schema.tasks.id, task.id));
        await this.safeComment(task, `## 기획 명세\n\n${spec}\n\n---\n이 명세로 구현을 시작합니다.`);
        await this.apply(task, { type: "stage_completed" }, "기획", "명세 확정 → 구현 대기");
        return;
      }

      case "implement": {
        const report = reports[0]!.report;
        if (!task.branch || !(await github.branchExists(task.repo, task.branch))) {
          await this.escalate(task.id, `작업 브랜치 ${task.branch ?? "(없음)"} 가 push 되지 않았습니다`);
          return;
        }
        let prNumber = task.prNumber ?? (await github.findOpenPr(task.repo, task.branch));
        if (prNumber === null && task.issueNumber !== null) {
          prNumber = await github.createPr(task.repo, {
            title: prTitle(task.issueNumber, task.title),
            body: prBody({ cause: report.cause, changes: report.changes, verification: report.verification, notes: report.notes, issueNumber: task.issueNumber }),
            head: task.branch,
            base: baseBranch,
            labels: task.labels,
            assignee: config.OFFAI_ASSIGNEE,
          });
        } else if (prNumber !== null) {
          await github.comment(task.repo, prNumber, `재작업 반영 (${task.reworks}회차)\n\n${report.summary}\n\n${list("변경", report.changes)}${list("검증", report.verification)}`);
        }
        await this.deps.db.update(schema.tasks).set({ prNumber, findings: [] }).where(eq(schema.tasks.id, task.id));
        await this.apply({ ...task, prNumber }, { type: "stage_completed" }, "offai", `PR #${prNumber} 준비 완료 → 검증 대기`);
        return;
      }

      case "verify": {
        const requested = reports.filter((item) => item.report.outcome === "changes_requested");
        if (requested.length > 0) {
          const findings = requested.flatMap((item) => item.report.findings.map((finding) => `[${item.ref.team.name}] ${finding}`));
          await this.deps.db.update(schema.tasks).set({ findings }).where(eq(schema.tasks.id, task.id));
          if (task.prNumber !== null) await this.safeComment({ ...task, issueNumber: task.prNumber }, `검증 결과: 수정 요청\n\n${findings.map((item) => `- ${item}`).join("\n")}`);
          await this.apply(task, { type: "changes_requested" }, "검증", `수정 요청 ${findings.length}건`);
          return;
        }
        if (task.prNumber !== null) {
          const summary = reports.map((item) => `**${item.ref.team.name}**: ${item.report.summary}\n${list("검증", item.report.verification)}`).join("\n");
          await this.safeComment({ ...task, issueNumber: task.prNumber }, `검증 통과. merge 판단을 기다립니다.\n\n${summary}`);
        }
        await this.apply(task, { type: "stage_completed" }, "검증", "검증 통과 → merge 대기");
        return;
      }

      case "release": {
        const [primary, ...others] = reports;
        const report = primary!.report;
        // 마케팅팀처럼 배포 준비에 조건부로 참여한 팀의 결과물을 요청서 뒤에 붙인다
        const extras = others
          .map((item) => `### ${item.ref.team.name}\n\n${item.report.summary}\n\n${list("내용", item.report.notes)}`)
          .join("\n");
        const target = task.prNumber ?? task.issueNumber;
        if (target !== null) {
          await this.safeComment(
            { ...task, issueNumber: target },
            `production 배포 요청\n\n${report.summary}\n\n${list("변경", report.changes)}${list("확인", report.verification)}${list("위험·롤백", report.notes)}${extras ? `${extras}\n` : ""}\noffAI 콘솔에서 배포 승인을 기록하면 작업이 완료됩니다.`,
          );
        }
        await this.apply(task, { type: "stage_completed" }, "릴리스", "배포 요청서 작성 → 사람 배포 승인 대기");
        return;
      }

      case "operate": {
        const report = reports[0]!.report;
        for (const followup of report.followups) {
          // 자동 구현으로 이어지지 않도록 트리거 label 없이 만든다. 사람이 label을 붙이면 접수된다.
          const number = await github.createIssue(task.repo, {
            title: followup.title,
            body: `${followup.body}\n\n---\nSRE 정기 점검에서 발견한 항목입니다. 진행하려면 \`${config.OFFAI_TRIGGER_LABEL}\` label을 붙이세요.`,
            labels: ["🔧 maintenance"],
            assignee: config.OFFAI_ASSIGNEE,
          });
          await addTaskEvent(this.deps.db, task.id, "SRE", `후속 Issue #${number}: ${followup.title}`);
        }
        await this.apply(task, { type: "stage_completed" }, "SRE", `점검 완료: ${report.summary}`);
        return;
      }
    }
  }

  // ───────────────────────── 정기 점검 ─────────────────────────

  async scheduleOperate(now = new Date()): Promise<void> {
    const { db, config } = this.deps;
    if (config.OPERATE_INTERVAL_HOURS <= 0) return;
    const { org } = await loadOrg(db);
    const since = new Date(now.getTime() - config.OPERATE_INTERVAL_HOURS * 3_600_000);
    for (const repo of org.repos) {
      const [recent] = await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.repo, repo), eq(schema.tasks.stage, "operate"), isNull(schema.tasks.issueNumber), gte(schema.tasks.createdAt, since)))
        .limit(1);
      if (recent) continue;
      const team = routeTask(org, { stage: "operate", labels: [] });
      const [task] = await db
        .insert(schema.tasks)
        .values({ repo, title: `정기 점검 ${now.toISOString().slice(0, 10)}`, labels: [], teamId: team.team.id, ...initialState("operate") })
        .returning();
      if (task) await addTaskEvent(db, task.id, "offai", "정기 점검 예약");
    }
  }

  // ───────────────────────── 상태 갱신 ─────────────────────────

  private async apply(task: Task, event: TaskEvent, actor: string, message?: string): Promise<void> {
    await this.applyById(task.id, event, actor, message);
  }

  async applyById(taskId: string, event: TaskEvent, actor: string, message?: string): Promise<void> {
    await applyTaskEvent(this.deps.db, taskId, event, actor, message);
  }

  private async escalate(taskId: string, reason: string): Promise<void> {
    await this.applyById(taskId, { type: "escalate", reason }, "offai");
    const [task] = await this.deps.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (task) await this.safeComment(task, `offAI가 작업을 멈췄습니다. 사람 확인이 필요합니다.\n\n사유: ${reason}`);
  }

  private async safeComment(task: Pick<Task, "repo" | "issueNumber">, body: string): Promise<void> {
    if (task.issueNumber === null) return;
    try {
      await this.deps.github.comment(task.repo, task.issueNumber, body);
    } catch (error) {
      this.deps.log.warn(`GitHub 코멘트 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 테스트·진단용: 실행 중인 작업 수 */
  get activeCount(): number {
    return this.active.size;
  }
}

function stateOf(task: Task): TaskState {
  return { stage: task.stage, status: task.status, reworks: task.reworks, reason: task.reason };
}

function list(title: string, items: string[]): string {
  return items.length ? `${title}\n${items.map((item) => `- ${item}`).join("\n")}\n\n` : "";
}

