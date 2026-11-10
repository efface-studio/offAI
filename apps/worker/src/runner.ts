import type Anthropic from "@anthropic-ai/sdk";
import { reportSchema, toMinorUnits, type Report } from "@offai/core";
import { REPORT_TOOL_NAME } from "./agents";
import { REPO_PATH } from "./brief";

type StreamEvent = Anthropic.Beta.Sessions.BetaManagedAgentsStreamSessionEvents;
type ToolUseEvent = Anthropic.Beta.Sessions.BetaManagedAgentsAgentToolUseEvent | Anthropic.Beta.Sessions.BetaManagedAgentsAgentMCPToolUseEvent;

export type ToolDecision = { result: "allow" | "deny"; message?: string };

/** 세션 안에서 일어난 일 (누가 무엇을). threadId 로 팀원을 구분한다. */
export type SessionActivity =
  | { kind: "member_joined"; threadId: string; agentName: string }
  | { kind: "delegated"; threadId: string; agentName: string | null; text: string }
  | { kind: "member_report"; threadId: string; agentName: string | null; text: string }
  | { kind: "tool"; threadId: string | null; tool: string; input: Record<string, unknown> }
  | { kind: "lead_message"; text: string };

export type RunHooks = {
  onSession(sessionId: string): Promise<void>;
  /** 멈춘 도구 호출을 판정한다. 사람 승인을 기다리는 동안 resolve 되지 않을 수 있다. */
  decideTool(event: { id: string; name: string; input: Record<string, unknown>; threadId: string | null }): Promise<ToolDecision>;
  onCost(costCents: number): Promise<void>;
  onActivity(activity: SessionActivity): Promise<void>;
  log(message: string): void;
};

export type RunInput = {
  agentId: string;
  environmentId: string;
  title: string;
  repo: string;
  repoToken: string;
  checkoutBranch: string;
  brief: string;
  budgetCents: number;
  timeoutMs: number;
};

export type RunResult =
  | { ok: true; sessionId: string; report: Report; costCents: number }
  | { ok: false; sessionId: string | null; error: string; costCents: number };

/** list_cost.amount 를 센트로 바꾼다 (정수 문자열이면 이미 센트) */
type ContentBlock = { type: string; text?: string };

function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function costToCents(amount: string): number {
  if (/^\d+$/.test(amount)) return Number.parseInt(amount, 10);
  const value = Number.parseFloat(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/**
 * Managed Agents 세션 하나를 끝까지 실행한다.
 * - 스트림을 먼저 열고 메시지를 보낸다 (stream-first)
 * - 스트림이 끊기면 이벤트 목록과 합쳐 중복을 제거하며 다시 연결한다
 * - 멈춘 도구 호출(always_ask)은 hooks.decideTool 로 판정한다 (팀원 스레드 요청도 세션 스트림에 모인다)
 */
export async function runSession(client: Anthropic, input: RunInput, hooks: RunHooks): Promise<RunResult> {
  const session = await client.beta.sessions.create({
    agent: input.agentId,
    environment_id: input.environmentId,
    title: input.title,
    resources: [
      {
        type: "github_repository",
        url: `https://github.com/${input.repo}`,
        mount_path: REPO_PATH,
        authorization_token: input.repoToken,
        checkout: { type: "branch", name: input.checkoutBranch },
      },
    ],
    budget: { type: "limit", max_list_cost: { amount: toMinorUnits(input.budgetCents), currency: "USD" } },
  });
  await hooks.onSession(session.id);
  hooks.log(`세션 시작 ${session.id}`);

  const deadline = Date.now() + input.timeoutMs;
  const seen = new Set<string>();
  let report: Report | null = null;
  let costCents = 0;
  let nudged = false;
  let sentKickoff = false;

  const send = (events: Anthropic.Beta.Sessions.BetaManagedAgentsEventParams[]) => client.beta.sessions.events.send(session.id, { events });

  const answerTool = async (event: ToolUseEvent) => {
    const decision = await hooks.decideTool({
      id: event.id,
      name: event.name,
      input: event.input,
      threadId: event.session_thread_id ?? null,
    });
    await send([
      {
        type: "user.tool_confirmation",
        tool_use_id: event.id,
        result: decision.result,
        ...(decision.result === "deny" && decision.message ? { deny_message: decision.message } : {}),
      },
    ]);
  };

  /** 이벤트 하나를 처리한다. 세션이 끝났으면 결과를 돌려준다. */
  const handle = async (event: StreamEvent): Promise<RunResult | null> => {
    if ("id" in event && typeof event.id === "string") {
      if (seen.has(event.id)) return null;
      seen.add(event.id);
    }

    switch (event.type) {
      case "agent.tool_use":
      case "agent.mcp_tool_use":
        await hooks.onActivity({ kind: "tool", threadId: event.session_thread_id ?? null, tool: event.name, input: event.input });
        if (event.evaluated_permission === "ask") await answerTool(event);
        return null;

      case "session.thread_created":
        await hooks.onActivity({ kind: "member_joined", threadId: event.session_thread_id, agentName: event.agent_name });
        return null;

      case "agent.thread_message_sent": {
        const text = textOf(event.content);
        if (text) await hooks.onActivity({ kind: "delegated", threadId: event.to_session_thread_id, agentName: event.to_agent_name ?? null, text });
        return null;
      }

      case "agent.thread_message_received": {
        const text = textOf(event.content);
        if (text) await hooks.onActivity({ kind: "member_report", threadId: event.from_session_thread_id, agentName: event.from_agent_name ?? null, text });
        return null;
      }

      case "agent.message": {
        const text = textOf(event.content);
        if (text) await hooks.onActivity({ kind: "lead_message", text });
        return null;
      }

      case "agent.custom_tool_use": {
        if (event.name !== REPORT_TOOL_NAME) {
          await send([
            { type: "user.custom_tool_result", custom_tool_use_id: event.id, is_error: true, content: [{ type: "text", text: "알 수 없는 도구" }] },
          ]);
          return null;
        }
        const parsed = reportSchema.safeParse(event.input);
        if (!parsed.success) {
          const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
          await send([
            {
              type: "user.custom_tool_result",
              custom_tool_use_id: event.id,
              is_error: true,
              content: [{ type: "text", text: `보고 형식이 맞지 않습니다. 고쳐서 다시 호출하세요: ${problems}` }],
            },
          ]);
          return null;
        }
        report = parsed.data;
        await send([
          { type: "user.custom_tool_result", custom_tool_use_id: event.id, content: [{ type: "text", text: "보고를 받았습니다. 추가 작업 없이 종료하세요." }] },
        ]);
        return null;
      }

      case "session.usage":
        if (event.usage.list_cost) {
          costCents = costToCents(event.usage.list_cost.amount);
          await hooks.onCost(costCents);
        }
        return null;

      case "session.status_idle": {
        const reason = event.stop_reason.type;
        if (reason === "requires_action") return null;
        if (reason === "end_turn") {
          if (report) return { ok: true, sessionId: session.id, report, costCents };
          if (!nudged) {
            nudged = true;
            await send([{ type: "user.message", content: [{ type: "text", text: "작업을 마쳤다면 report_result 도구로 결과를 보고하세요." }] }]);
            return null;
          }
          return { ok: false, sessionId: session.id, error: "팀장이 report_result 로 보고하지 않고 종료했습니다", costCents };
        }
        if (reason === "budget_reached") {
          return { ok: false, sessionId: session.id, error: `세션 예산(${input.budgetCents / 100} USD)에 도달했습니다`, costCents };
        }
        return { ok: false, sessionId: session.id, error: `세션이 멈췄습니다 (${reason})`, costCents };
      }

      case "session.status_terminated":
        return report
          ? { ok: true, sessionId: session.id, report, costCents }
          : { ok: false, sessionId: session.id, error: "세션이 종료되었습니다", costCents };

      case "session.error":
        hooks.log(`세션 오류 이벤트: ${JSON.stringify(event).slice(0, 300)}`);
        return null;

      default:
        return null;
    }
  };

  for (let attempt = 0; attempt < 20; attempt++) {
    if (Date.now() > deadline) break;
    try {
      const stream = await client.beta.sessions.events.stream(session.id);
      if (!sentKickoff) {
        sentKickoff = true;
        await send([{ type: "user.message", content: [{ type: "text", text: input.brief }] }]);
      } else {
        // 재연결: 끊긴 동안의 이벤트를 목록에서 보충한다
        for await (const past of client.beta.sessions.events.list(session.id)) {
          const result = await handle(past as StreamEvent);
          if (result) return result;
        }
      }
      for await (const event of stream) {
        const result = await handle(event);
        if (result) return result;
        if (Date.now() > deadline) break;
      }
    } catch (error) {
      hooks.log(`스트림 연결이 끊겼습니다 (${attempt + 1}회): ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 30_000)));
    }
  }

  await send([{ type: "user.interrupt" }]).catch(() => undefined);
  return { ok: false, sessionId: session.id, error: "세션 실행 시간 한도를 넘었습니다", costCents };
}
