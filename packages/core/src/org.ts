import { z } from "zod";

/** 작업 라이프사이클에서 팀이 맡는 단계 (순서대로 진행) */
export const STAGES = ["plan", "implement", "verify", "release", "operate"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  plan: "기획",
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

/**
 * 직급. 팀장은 팀마다 정확히 1명이며 세션의 coordinator 가 된다.
 * 나머지는 팀장이 일을 맡기는 팀원(subagent)이다.
 */
export const RANKS = ["팀장", "책임", "선임", "주임", "사원"] as const;
export type Rank = (typeof RANKS)[number];

export const GENDERS = ["female", "male"] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * 팀이 단계에 참여하는 방식
 * - primary: 단계의 주 담당 (label 로 고르고, 없으면 기본 팀)
 * - conditional: label 이나 변경 경로가 맞을 때만 추가로 참여 (보안, 법무, 디자인 등)
 */
export const ASSIGNMENTS = ["primary", "conditional"] as const;
export type Assignment = (typeof ASSIGNMENTS)[number];

const slug = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "ID는 소문자, 숫자, 하이픈만 쓸 수 있습니다");

const repo = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "레포는 owner/name 형식이어야 합니다");

export const personSchema = z.object({
  name: z.string().min(1).max(20),
  gender: z.enum(GENDERS),
  /** 업계 경력 연차 */
  years: z.number().int().min(0).max(50).default(10),
  /** 경력 배경 한 줄 (예: 대형 법무법인 파트너 변호사) */
  background: z.string().max(200).default(""),
});
export type Person = z.infer<typeof personSchema>;

export const roleSchema = z.object({
  id: slug,
  /** 직무명 (예: 프론트엔드 개발) */
  name: z.string().min(1).max(40),
  rank: z.enum(RANKS),
  person: personSchema,
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
  /** 팀의 전문 분야 (system prompt 에 들어간다) */
  domain: z.string().max(60).default(""),
  assignment: z.enum(ASSIGNMENTS),
  /** primary: 이 label 이 붙은 작업을 우선 맡는다 / conditional: 이 label 이 붙으면 참여한다 */
  labels: z.array(z.string().min(1)).max(10),
  /** conditional 팀: 이 경로가 바뀌면 참여한다 (glob 일부: `**`, `*`) */
  triggerPaths: z.array(z.string().min(1)).max(30),
  /** 세션 1회 비용 상한 (USD 센트) */
  sessionBudgetCents: z.number().int().positive().max(100_000),
  roles: z.array(roleSchema).min(1).max(20),
});
export type Team = z.infer<typeof teamSchema>;

export const divisionSchema = z.object({
  id: slug,
  name: z.string().min(1).max(40),
  mission: z.string().min(1).max(200),
  /** 본부장. 라우팅·예산은 규칙으로 처리하므로 에이전트가 아니라 조직도 표시용이다. */
  head: personSchema,
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
    /** 검증 실패 후 재구현 최대 횟수 */
    maxReworks: z.number().int().min(0).max(5),
    divisions: z.array(divisionSchema).min(1),
  })
  .superRefine((org, ctx) => {
    const teamIds = new Set<string>();
    const roleIds = new Set<string>();
    for (const division of org.divisions) {
      for (const team of division.teams) {
        if (teamIds.has(team.id)) ctx.addIssue({ code: "custom", message: `팀 ID가 중복됩니다: ${team.id}` });
        teamIds.add(team.id);
        for (const role of team.roles) {
          if (roleIds.has(role.id)) ctx.addIssue({ code: "custom", message: `역할 ID가 중복됩니다: ${role.id}` });
          roleIds.add(role.id);
        }
        const leads = team.roles.filter((role) => role.rank === "팀장").length;
        if (leads !== 1) {
          ctx.addIssue({ code: "custom", message: `${team.name}은 팀장이 정확히 1명이어야 합니다 (현재 ${leads}명)` });
        }
      }
    }
    for (const stage of ["plan", "implement", "verify", "release", "operate"] as const) {
      const primary = org.divisions.flatMap((division) => division.teams).some((team) => team.stage === stage && team.assignment === "primary");
      if (!primary) ctx.addIssue({ code: "custom", message: `${STAGE_LABEL[stage]} 단계를 주로 맡는 팀이 하나 이상 있어야 합니다` });
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
  const lead = team.roles.find((role) => role.rank === "팀장");
  if (!lead) throw new Error(`${team.id} 팀에 팀장이 없습니다`);
  return lead;
}

export function isLead(role: Role): boolean {
  return role.rank === "팀장";
}

/** 직급 순으로 정렬 */
export function byRank(roles: readonly Role[]): Role[] {
  return [...roles].sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));
}
