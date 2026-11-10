import { listTeams, type Org, type Stage, type TeamRef } from "./org.js";

export type RoutingInput = {
  stage: Stage;
  labels: readonly string[];
  /** verify 단계에서 보안 검토 여부를 정할 때 쓰는 변경 파일 경로 */
  changedFiles?: readonly string[];
};

/**
 * 단계와 Issue label로 담당 팀을 고른다.
 * 같은 단계의 팀 중 label이 겹치는 팀을 우선하고, 없으면 label 조건이 없는 팀, 그다음 첫 팀을 고른다.
 * verify 단계의 보안팀은 primary로 고르지 않고 needsSecurityReview로 따로 판단한다.
 */
export function routeTask(org: Org, input: RoutingInput): TeamRef {
  const candidates = listTeams(org).filter(({ team }) => team.stage === input.stage && team.id !== "security");
  const matched = candidates.find(({ team }) => team.labels.some((label) => input.labels.includes(label)));
  const fallback = candidates.find(({ team }) => team.labels.length === 0) ?? candidates[0];
  const picked = matched ?? fallback;
  if (!picked) throw new Error(`${input.stage} 단계를 맡는 팀이 없습니다`);
  return picked;
}

export function needsSecurityReview(org: Org, input: RoutingInput): boolean {
  if (input.labels.includes("🔒 security")) return true;
  return (input.changedFiles ?? []).some((file) => org.securityPaths.some((pattern) => matchGlob(pattern, file)));
}

/** `**`(여러 단계), `*`(한 단계 안)만 지원하는 최소 glob */
export function matchGlob(pattern: string, path: string): boolean {
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      regex += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") {
      regex += "[^/]*";
    } else {
      regex += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regex}$`).test(path);
}
