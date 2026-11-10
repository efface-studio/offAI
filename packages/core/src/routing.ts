import { listTeams, type Org, type Stage, type TeamRef } from "./org";

export type RoutingInput = {
  stage: Stage;
  labels: readonly string[];
  /** 변경 파일 경로 (검증 단계의 조건부 팀 판단용) */
  changedFiles?: readonly string[];
};

/**
 * 단계의 주 담당 팀을 고른다.
 * primary 팀 중 label 이 겹치는 팀을 우선하고, 없으면 label 조건이 없는 팀, 그다음 첫 팀을 고른다.
 */
export function routeTask(org: Org, input: RoutingInput): TeamRef {
  const candidates = listTeams(org).filter(({ team }) => team.stage === input.stage && team.assignment === "primary");
  const matched = candidates.find(({ team }) => team.labels.some((label) => input.labels.includes(label)));
  const fallback = candidates.find(({ team }) => team.labels.length === 0) ?? candidates[0];
  const picked = matched ?? fallback;
  if (!picked) throw new Error(`${input.stage} 단계를 맡는 팀이 없습니다`);
  return picked;
}

/** 조건이 맞아 이번 단계에 함께 참여할 조건부 팀 (label 또는 변경 경로) */
export function conditionalTeams(org: Org, input: RoutingInput): TeamRef[] {
  return listTeams(org).filter(({ team }) => {
    if (team.stage !== input.stage || team.assignment !== "conditional") return false;
    if (team.labels.some((label) => input.labels.includes(label))) return true;
    return (input.changedFiles ?? []).some((file) => team.triggerPaths.some((pattern) => matchGlob(pattern, file)));
  });
}

/** 단계에 참여하는 모든 팀: 주 담당 다음에 조건부 팀 */
export function teamsForStage(org: Org, input: RoutingInput): TeamRef[] {
  return [routeTask(org, input), ...conditionalTeams(org, input)];
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
