import { STAGE_LABEL, type Org, type Stage } from "./org";
import type { Report } from "./report";
import { routeTask } from "./routing";
import type { TaskState } from "./task";

export const OUTCOME_LABEL: Record<Report["outcome"], string> = {
  completed: "완료",
  changes_requested: "수정 요청",
  blocked: "진행 불가",
};

/** 팀 보고 본문 (Markdown). 인계 자료와 화면에 함께 쓴다. */
export function reportBody(report: Report): string {
  const section = (title: string, items: string[]) => (items.length ? `**${title}**\n${items.map((item) => `- ${item}`).join("\n")}` : "");
  return [
    section("변경", report.changes),
    section("검증", report.verification),
    section("수정 요청", report.findings),
    section("질문", report.questions),
    section("비고", report.notes),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type HandoffEntry = {
  stage: Stage;
  teamName: string;
  divisionName: string;
  outcome: Report["outcome"];
  summary: string;
  body: string;
};

/**
 * 앞 팀들의 보고를 다음 팀 브리프에 넣을 인계 자료로 만든다.
 * 길이가 넘치면 오래된 보고부터 본문을 빼고 요약만 남긴다.
 */
export function buildHandoff(entries: readonly HandoffEntry[], maxChars = 6000): string {
  if (entries.length === 0) return "";
  const render = (entry: HandoffEntry, withBody: boolean) =>
    [`### [${STAGE_LABEL[entry.stage]}] ${entry.divisionName} ${entry.teamName} — ${OUTCOME_LABEL[entry.outcome]}`, entry.summary, withBody ? entry.body : ""]
      .filter(Boolean)
      .join("\n\n");

  const blocks = entries.map((entry) => render(entry, true));
  for (let i = 0; i < blocks.length && blocks.join("\n\n").length > maxChars; i++) {
    blocks[i] = render(entries[i]!, false);
  }
  let text = blocks.join("\n\n");
  if (text.length > maxChars) text = `…(앞부분 생략)\n\n${text.slice(text.length - maxChars)}`;
  return text;
}

export type NextStep = { teamId: string | null; human: string | null };

/** 상태 전이 후 다음 담당 (팀 또는 사람) */
export function nextStep(org: Org, state: TaskState, labels: readonly string[]): NextStep {
  switch (state.status) {
    case "queued":
      return { teamId: routeTask(org, { stage: state.stage, labels }).team.id, human: null };
    case "awaiting_merge":
      return { teamId: null, human: "PR 검토와 merge" };
    case "awaiting_deploy":
      return { teamId: null, human: "production 배포" };
    case "escalated":
      return { teamId: null, human: `사람 확인${state.reason ? `: ${state.reason}` : ""}` };
    default:
      return { teamId: null, human: null };
  }
}
