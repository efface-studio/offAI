/**
 * 실제 Postgres에서 작업 흐름 전체를 검증한다. 세션 실행과 GitHub는 가짜로 대체한다.
 * TEST_DATABASE_URL 이 있을 때만 실행한다 (로컬: docker compose 의 offai_test DB).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_ORG, leadOf, listTeams, type Report, type Stage } from "@offai/core";
import { createDb, eq, runMigrations, saveOrg, schema, setSetting, sql, type Db } from "@offai/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "./config";
import { ENVIRONMENT_SETTING, Orchestrator, SYNCED_ORG_SETTING, type GitHubPort } from "./orchestrator";
import type { RunInput, RunResult, runSession } from "./runner";

const url = process.env.TEST_DATABASE_URL;

const config: Config = {
  DATABASE_URL: url ?? "",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "x",
  GITHUB_WEBHOOK_SECRET: "x".repeat(16),
  OFFAI_TRIGGER_LABEL: "offai",
  OFFAI_ASSIGNEE: "xixn2",
  WORKER_PORT: 0,
  MAX_CONCURRENCY: 2,
  OPERATE_INTERVAL_HOURS: 24,
  SESSION_TIMEOUT_MINUTES: 1,
};

const REPO = "efface-studio/Portfolio";

class FakeGitHub implements GitHubPort {
  branches = new Set<string>(["main"]);
  prs: { number: number; head: string; title: string; body: string; labels: string[] }[] = [];
  comments: { issue: number; body: string }[] = [];
  issues: { title: string; labels: string[] }[] = [];
  changed: string[] = [];

  defaultBranch = async () => "main";
  changedFiles = async () => this.changed;
  branchExists = async (_repo: string, branch: string) => this.branches.has(branch);
  findOpenPr = async (_repo: string, branch: string) => this.prs.find((pr) => pr.head === branch)?.number ?? null;
  createPr = async (_repo: string, input: { title: string; body: string; head: string; labels: string[] }) => {
    const number = 100 + this.prs.length;
    this.prs.push({ number, head: input.head, title: input.title, body: input.body, labels: input.labels });
    return number;
  };
  comment = async (_repo: string, issue: number, body: string) => {
    this.comments.push({ issue, body });
  };
  createIssue = async (_repo: string, input: { title: string; labels: string[] }) => {
    this.issues.push(input);
    return 500 + this.issues.length;
  };
  installationToken = async () => "ghs_fake";
}

type Script = (input: RunInput, hooks: Parameters<typeof runSession>[2]) => Promise<Report>;

function report(outcome: Report["outcome"], extra: Partial<Report> = {}): Report {
  return { outcome, summary: `${outcome} 요약`, changes: [], cause: [], verification: ["pnpm test 통과"], findings: [], followups: [], notes: [], ...extra };
}

describe.skipIf(!url)("작업 흐름 (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let github: FakeGitHub;
  let scripts: Record<string, Script>;
  let calls: { team: string; stage: Stage; input: RunInput }[];
  let orchestrator: Orchestrator;

  const fakeRun: typeof runSession = async (_client, input, hooks): Promise<RunResult> => {
    const task = await db.query.runs.findFirst({ orderBy: (runs, { desc }) => [desc(runs.startedAt)] });
    const team = task?.teamId ?? "?";
    calls.push({ team, stage: task!.stage, input });
    await hooks.onSession(`sesn_${calls.length}`);
    const script = scripts[`${task!.stage}:${team}`] ?? scripts[task!.stage];
    if (!script) return { ok: false, sessionId: `sesn_${calls.length}`, error: "스크립트 없음", costCents: 0 };
    const result = await script(input, hooks);
    await hooks.onCost(120);
    return { ok: true, sessionId: `sesn_${calls.length}`, report: result, costCents: 120 };
  };

  const step = async () => {
    await orchestrator.tick();
    await orchestrator.idle();
  };

  const currentTask = async () => {
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.issueNumber, 12));
    return task!;
  };

  beforeAll(async () => {
    ({ db, close } = createDb(url!, { max: 4 }));
    await runMigrations(db);
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table task_events, approvals, runs, tasks, agents, settings, org_versions restart identity cascade`);
    const version = await saveOrg(db, DEFAULT_ORG, "test");
    await setSetting(db, SYNCED_ORG_SETTING, String(version));
    await setSetting(db, ENVIRONMENT_SETTING, "env_test");
    for (const { team } of listTeams(DEFAULT_ORG)) {
      const lead = leadOf(team);
      await db.insert(schema.agents).values({ roleId: lead.id, agentId: `agent_${lead.id}`, agentVersion: 1, configHash: "x" });
    }
    github = new FakeGitHub();
    calls = [];
    scripts = {};
    orchestrator = new Orchestrator({
      db,
      anthropic: {} as Anthropic,
      github,
      config,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      runSession: fakeRun,
      approvalPollMs: 20,
    });
  });

  it("구현 → 검증(수정 요청) → 재구현 → 검증 통과 → merge → 릴리스 → 배포 승인", async () => {
    await orchestrator.handleWebhook({ type: "enqueue", repo: REPO, issueNumber: 12, title: "Footer link fix", body: "고쳐 주세요", labels: ["🖥️ web", "✨ feature"] });
    expect(await currentTask()).toMatchObject({ stage: "implement", status: "queued", teamId: "web", branch: "feat/12-footer-link-fix" });
    expect(github.comments[0]?.body).toContain("Web팀");

    let verifyRound = 0;
    scripts = {
      implement: async (input) => {
        github.branches.add("feat/12-footer-link-fix");
        expect(input.agentId).toBe("agent_web-lead");
        return report("completed", { changes: ["footer 링크 수정"], cause: ["링크 오타"] });
      },
      "verify:qa": async () => {
        verifyRound++;
        return verifyRound === 1 ? report("changes_requested", { findings: ["app/footer.tsx:8 테스트 누락"] }) : report("completed");
      },
      "verify:security": async () => report("completed"),
      release: async () => report("completed", { notes: ["롤백: 이전 커밋 revert"] }),
    };

    await step(); // 구현
    let task = await currentTask();
    expect(task).toMatchObject({ stage: "verify", status: "queued", prNumber: 100 });
    expect(github.prs[0]).toMatchObject({ title: "🔀 :: (#12) Footer link fix", labels: ["🖥️ web", "✨ feature"] });
    expect(github.prs[0]!.body).toContain("Closes #12");
    expect(calls[0]!.input.checkoutBranch).toBe("main");

    github.changed = ["app/auth/session.ts"]; // 보안 경로 → 보안팀 추가
    await step(); // 검증 1회차: 수정 요청
    task = await currentTask();
    expect(task).toMatchObject({ stage: "implement", status: "queued", reworks: 1 });
    expect(task.findings).toEqual(["[QA팀] app/footer.tsx:8 테스트 누락"]);

    await step(); // 재구현: 기존 브랜치 checkout, 수정 요청 전달
    const rework = calls.at(-1)!;
    expect(rework.input.checkoutBranch).toBe("feat/12-footer-link-fix");
    expect(rework.input.brief).toContain("app/footer.tsx:8 테스트 누락");
    expect(github.prs).toHaveLength(1);

    await step(); // 검증 2회차: QA + 보안 통과
    task = await currentTask();
    expect(task).toMatchObject({ stage: "verify", status: "awaiting_merge" });
    // 수정 요청을 한 번에 모으기 위해 QA가 수정 요청을 내도 보안 검토까지 실행한다
    expect(calls.filter((call) => call.stage === "verify").map((call) => call.team)).toEqual(["qa", "security", "qa", "security"]);

    await step(); // 사람이 merge 하기 전에는 아무것도 하지 않는다
    expect((await currentTask()).status).toBe("awaiting_merge");

    await orchestrator.handleWebhook({ type: "pr_closed", repo: REPO, prNumber: 100, merged: true });
    expect(await currentTask()).toMatchObject({ stage: "release", status: "queued" });

    await step(); // 릴리스
    expect(await currentTask()).toMatchObject({ stage: "release", status: "awaiting_deploy" });
    expect(github.comments.at(-1)?.body).toContain("production 배포 요청");

    await orchestrator.applyById(task.id, { type: "deploy_approved" }, "xixn2");
    expect((await currentTask()).status).toBe("done");

    const runs = await db.select().from(schema.runs);
    expect(runs.every((run) => run.status === "completed" && run.costCents === 120)).toBe(true);
  });

  it("사람 확인이 필요한 명령은 승인함에서 승인될 때까지 기다린다", async () => {
    await orchestrator.handleWebhook({ type: "enqueue", repo: REPO, issueNumber: 12, title: "Add dep", body: "", labels: [] });
    const decisions: string[] = [];
    scripts = {
      implement: async (_input, hooks) => {
        decisions.push((await hooks.decideTool({ id: "tu_1", name: "bash", input: { command: "pnpm test" }, threadId: null })).result);
        decisions.push((await hooks.decideTool({ id: "tu_2", name: "bash", input: { command: "git push origin main" }, threadId: null })).result);
        const pending = hooks.decideTool({ id: "tu_3", name: "bash", input: { command: "pnpm add zod" }, threadId: "sthr_1" });
        // 승인 대기 상태가 되면 사람이 승인한다
        for (let i = 0; i < 100; i++) {
          const [row] = await db.select().from(schema.approvals).where(eq(schema.approvals.toolUseId, "tu_3"));
          if (row) {
            expect((await currentTask()).status).toBe("awaiting_approval");
            await db.update(schema.approvals).set({ status: "allowed", decidedBy: "xixn2", decidedAt: new Date() }).where(eq(schema.approvals.id, row.id));
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        decisions.push((await pending).result);
        github.branches.add("feat/12-add-dep");
        return report("completed");
      },
    };
    await step();
    expect(decisions).toEqual(["allow", "deny", "allow"]);
    expect(await currentTask()).toMatchObject({ stage: "verify", status: "queued" });
  });

  it("브랜치를 push 하지 않으면 PR 없이 사람에게 넘긴다", async () => {
    await orchestrator.handleWebhook({ type: "enqueue", repo: REPO, issueNumber: 12, title: "No push", body: "", labels: [] });
    scripts = { implement: async () => report("completed") };
    await step();
    const task = await currentTask();
    expect(task.status).toBe("escalated");
    expect(task.reason).toContain("push 되지 않았습니다");
    expect(github.prs).toHaveLength(0);
  });

  it("본부 월 예산이 부족하면 세션을 시작하지 않는다", async () => {
    await orchestrator.handleWebhook({ type: "enqueue", repo: REPO, issueNumber: 12, title: "Budget", body: "", labels: [] });
    const [task] = await db.select().from(schema.tasks);
    await db.insert(schema.runs).values({ taskId: task!.id, stage: "implement", divisionId: "product", teamId: "web", status: "completed", budgetCents: 1, costCents: 29_500 });
    scripts = { implement: async () => report("completed") };
    await step();
    expect(calls).toHaveLength(0);
    expect((await currentTask()).reason).toContain("월 예산");
  });

  it("정기 점검은 주기마다 한 번만 만들고 후속 Issue는 트리거 label 없이 만든다", async () => {
    await orchestrator.scheduleOperate();
    await orchestrator.scheduleOperate();
    const operateTasks = await db.select().from(schema.tasks).where(eq(schema.tasks.stage, "operate"));
    expect(operateTasks).toHaveLength(1);
    scripts = { operate: async () => report("completed", { followups: [{ title: "의존성 경고", body: "본문" }] }) };
    await step();
    expect(github.issues).toEqual([{ title: "의존성 경고", body: expect.any(String), labels: ["🔧 maintenance"], assignee: "xixn2" }]);
    const [done] = await db.select().from(schema.tasks).where(eq(schema.tasks.stage, "operate"));
    expect(done!.status).toBe("done");
  });
});
