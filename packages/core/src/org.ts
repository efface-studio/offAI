import { z } from "zod";

/** 작업 라이프사이클에서 팀이 맡는 단계 */
export const STAGES = ["implement", "verify", "release", "operate"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  implement: "구현",
  verify: "검증",
  release: "배포 준비",
  operate: "운영",
};

export const MODEL_IDS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type Effort = (typeof EFFORTS)[number];

/** 역할이 쓸 수 있는 도구 묶음. Managed Agents agent_toolset 설정으로 변환된다. */
export const TOOL_PROFILES = ["full", "read_only"] as const;
export type ToolProfile = (typeof TOOL_PROFILES)[number];

const slug = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "소문자, 숫자, 하이픈만 쓸 수 있습니다");

const repo = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "owner/name 형식이어야 합니다");

export const roleSchema = z.object({
  id: slug,
  name: z.string().min(1).max(40),
  /** 팀장 역할은 팀마다 정확히 하나. 세션의 coordinator가 된다. */
  lead: z.boolean(),
  responsibility: z.string().min(1).max(200),
  instructions: z.string().min(1).max(4000),
  model: z.enum(MODEL_IDS),
  effort: z.enum(EFFORTS),
  tools: z.enum(TOOL_PROFILES),
});
export type Role = z.infer<typeof roleSchema>;

export const teamSchema = z.object({
  id: slug,
  name: z.string().min(1).max(40),
  stage: z.enum(STAGES),
  /** 이 팀이 맡는 작업을 고르는 Issue label. 비어 있으면 단계만으로 라우팅한다. */
  labels: z.array(z.string().min(1)).max(10),
  /** 세션 1회 비용 상한 (USD 센트) */
  sessionBudgetCents: z.number().int().positive().max(100_000),
  roles: z.array(roleSchema).min(1).max(20),
});
export type Team = z.infer<typeof teamSchema>;

export const divisionSchema = z.object({
  id: slug,
  name: z.string().min(1).max(40),
  mission: z.string().min(1).max(200),
  /** 본부 월 예산 (USD 센트) */
  monthlyBudgetCents: z.number().int().positive().max(10_000_000),
  teams: z.array(teamSchema).min(1).max(20),
});
export type Division = z.infer<typeof divisionSchema>;

export const orgSchema = z
  .object({
    name: z.string().min(1),
    /** offAI가 작업할 수 있는 레포 목록 */
    repos: z.array(repo).min(1),
    /** 이 경로가 바뀌면 보안 검토를 추가한다 (glob 일부: `**`, `*`) */
    securityPaths: z.array(z.string().min(1)),
    /** 검증 실패 후 재구현 최대 횟수 */
    maxReworks: z.number().int().min(0).max(5),
    divisions: z.array(divisionSchema).min(1),
  })
  .superRefine((org, ctx) => {
    const ids = new Set<string>();
    for (const division of org.divisions) {
      for (const team of division.teams) {
        if (ids.has(team.id)) {
          ctx.addIssue({ code: "custom", message: `팀 ID가 중복됩니다: ${team.id}` });
        }
        ids.add(team.id);
        const leads = team.roles.filter((role) => role.lead).length;
        if (leads !== 1) {
          ctx.addIssue({ code: "custom", message: `${team.name} 팀은 팀장 역할이 정확히 1명이어야 합니다 (현재 ${leads}명)` });
        }
      }
    }
  });
export type Org = z.infer<typeof orgSchema>;

export type TeamRef = { division: Division; team: Team };

export function listTeams(org: Org): TeamRef[] {
  return org.divisions.flatMap((division) => division.teams.map((team) => ({ division, team })));
}

export function findTeam(org: Org, teamId: string): TeamRef | undefined {
  return listTeams(org).find((ref) => ref.team.id === teamId);
}

export function leadOf(team: Team): Role {
  const lead = team.roles.find((role) => role.lead);
  if (!lead) throw new Error(`${team.id} 팀에 팀장 역할이 없습니다`);
  return lead;
}
