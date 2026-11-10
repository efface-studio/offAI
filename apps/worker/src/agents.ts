import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { REPORT_TOOL_INPUT_SCHEMA, leadOf, listTeams, type Division, type Org, type Role, type Team } from "@offai/core";
import { schema, type Db } from "@offai/db";
import { eq } from "@offai/db";

type AgentCreateParams = Anthropic.Beta.AgentCreateParams;
type AgentTools = NonNullable<AgentCreateParams["tools"]>;

export const REPORT_TOOL_NAME = "report_result";

/**
 * 역할의 도구 묶음을 agent_toolset 설정으로 바꾼다.
 * bash는 항상 always_ask 로 둔다. worker가 명령 정책(core/policy)으로 판정하고, 필요하면 사람에게 넘긴다.
 * 웹 도구는 쓰지 않는다.
 */
export function toolsetFor(role: Role): AgentTools[number] {
  if (role.tools === "read_only") {
    return {
      type: "agent_toolset_20260401",
      default_config: { enabled: false, permission_policy: { type: "always_allow" } },
      configs: [
        { name: "read", enabled: true },
        { name: "glob", enabled: true },
        { name: "grep", enabled: true },
      ],
    };
  }
  return {
    type: "agent_toolset_20260401",
    default_config: { enabled: true, permission_policy: { type: "always_allow" } },
    configs: [
      { name: "bash", enabled: true, permission_policy: { type: "always_ask" } },
      { name: "web_fetch", enabled: false },
      { name: "web_search", enabled: false },
    ],
  };
}

function systemPrompt(division: Division, team: Team, role: Role): string {
  return [
    `너는 efface의 AI 조직에서 ${division.name} ${team.name}의 ${role.name} 역할을 맡는다.`,
    `책임: ${role.responsibility}`,
    "",
    role.instructions,
    "",
    "모든 보고와 커밋 메시지, PR 관련 문구는 한국어로 쓴다. 코드, 명령어, 고유 명칭은 원문을 유지한다.",
  ].join("\n");
}

export function memberConfig(division: Division, team: Team, role: Role): AgentCreateParams {
  return {
    name: `offai/${team.id}/${role.id}`,
    description: `${team.name} ${role.name}: ${role.responsibility}`,
    model: { id: role.model, effort: role.effort },
    system: systemPrompt(division, team, role),
    tools: [toolsetFor(role)],
    metadata: { offai_role: role.id, offai_team: team.id },
  };
}

export function leadConfig(division: Division, team: Team, memberAgentIds: string[]): AgentCreateParams {
  const lead = leadOf(team);
  const config: AgentCreateParams = {
    ...memberConfig(division, team, lead),
    tools: [
      toolsetFor(lead),
      {
        type: "custom",
        name: REPORT_TOOL_NAME,
        description:
          "작업 단계가 끝났을 때 결과를 offAI에 보고한다. 세션마다 마지막에 정확히 한 번 호출한다. 실행하지 않은 검증은 verification에 '미검증'으로 적는다.",
        input_schema: REPORT_TOOL_INPUT_SCHEMA as unknown as Anthropic.Beta.Agents.BetaManagedAgentsCustomToolInputSchema,
      },
    ],
  };
  if (memberAgentIds.length > 0) {
    config.multiagent = {
      type: "multiagent_20261001",
      subagents: {
        type: "enabled",
        predefined_agents: memberAgentIds,
        inline_agents: { type: "disabled" },
      },
      // 팀 세션 하나가 PR 하나를 다루는 규모라 workflow run은 쓰지 않는다 (비용 통제)
      workflows: { type: "disabled" },
    };
  }
  return config;
}

export function hashConfig(config: AgentCreateParams): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

/**
 * 조직 설정을 Managed Agents agent로 동기화한다.
 * 역할마다 agent 하나. 바뀐 역할만 update 하고(새 버전), 없으면 create 한다.
 * 팀장 agent는 팀원 agent ID가 필요하므로 팀원 다음에 처리한다.
 */
export async function syncAgents(client: Anthropic, db: Db, org: Org, log: (message: string) => void): Promise<Map<string, string>> {
  const existing = new Map((await db.select().from(schema.agents)).map((row) => [row.roleId, row]));
  const agentIds = new Map<string, string>();

  const upsert = async (roleId: string, config: AgentCreateParams) => {
    const hash = hashConfig(config);
    const current = existing.get(roleId);
    if (current?.configHash === hash) {
      agentIds.set(roleId, current.agentId);
      return current.agentId;
    }
    const agent = current
      ? await client.beta.agents.update(current.agentId, { ...config, version: current.agentVersion })
      : await client.beta.agents.create(config);
    await db
      .insert(schema.agents)
      .values({ roleId, agentId: agent.id, agentVersion: agent.version, configHash: hash })
      .onConflictDoUpdate({
        target: schema.agents.roleId,
        set: { agentId: agent.id, agentVersion: agent.version, configHash: hash, updatedAt: new Date() },
      });
    log(`${current ? "갱신" : "생성"}: ${roleId} → ${agent.id} v${agent.version}`);
    agentIds.set(roleId, agent.id);
    return agent.id;
  };

  for (const { division, team } of listTeams(org)) {
    const lead = leadOf(team);
    const memberIds: string[] = [];
    for (const role of team.roles) {
      if (role.id === lead.id) continue;
      memberIds.push(await upsert(role.id, memberConfig(division, team, role)));
    }
    await upsert(lead.id, leadConfig(division, team, memberIds));
  }
  return agentIds;
}

export async function leadAgentId(db: Db, team: Team): Promise<string> {
  const lead = leadOf(team);
  const [row] = await db.select().from(schema.agents).where(eq(schema.agents.roleId, lead.id)).limit(1);
  if (!row) throw new Error(`${team.name} 팀장 agent가 아직 동기화되지 않았습니다`);
  return row.agentId;
}
