import type { Stage } from "./org";

export const TASK_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "awaiting_merge",
  "awaiting_deploy",
  "done",
  "escalated",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "대기",
  running: "진행 중",
  awaiting_approval: "도구 승인 대기",
  awaiting_merge: "merge 대기",
  awaiting_deploy: "배포 승인 대기",
  done: "완료",
  escalated: "사람 확인 필요",
};

/** 사람이 처리해야 하는 상태 */
export const HUMAN_STATUSES: readonly TaskStatus[] = ["awaiting_approval", "awaiting_merge", "awaiting_deploy", "escalated"];

export type TaskState = {
  stage: Stage;
  status: TaskStatus;
  reworks: number;
  /** escalated 일 때 사유 */
  reason: string | null;
};

export type TaskEvent =
  | { type: "start" }
  | { type: "approval_requested" }
  | { type: "approval_resolved" }
  | { type: "stage_completed" }
  | { type: "changes_requested" }
  | { type: "pr_merged" }
  | { type: "pr_closed" }
  | { type: "deploy_approved" }
  | { type: "escalate"; reason: string }
  | { type: "retry" };

export class InvalidTransitionError extends Error {
  constructor(state: TaskState, event: TaskEvent) {
    super(`${state.stage}/${state.status} 상태에서 ${event.type} 이벤트를 처리할 수 없습니다`);
    this.name = "InvalidTransitionError";
  }
}

export function initialState(stage: Stage = "plan"): TaskState {
  return { stage, status: "queued", reworks: 0, reason: null };
}

/**
 * 작업 상태 머신. 순수 함수이며 DB 갱신은 호출 측이 한다.
 *
 * plan → implement → verify → (사람 merge) → release → (사람 배포 승인) → done
 * operate 단계 작업은 한 번 실행하고 끝난다.
 */
export function transition(state: TaskState, event: TaskEvent, maxReworks: number): TaskState {
  const next = (patch: Partial<TaskState>): TaskState => ({ ...state, reason: null, ...patch });
  const fail = (): never => {
    throw new InvalidTransitionError(state, event);
  };

  switch (event.type) {
    case "start":
      return state.status === "queued" ? next({ status: "running" }) : fail();

    case "approval_requested":
      return state.status === "running" ? next({ status: "awaiting_approval" }) : fail();

    case "approval_resolved":
      return state.status === "awaiting_approval" ? next({ status: "running" }) : fail();

    case "stage_completed":
      if (state.status !== "running") return fail();
      switch (state.stage) {
        case "plan":
          return next({ stage: "implement", status: "queued" });
        case "implement":
          return next({ stage: "verify", status: "queued" });
        case "verify":
          return next({ status: "awaiting_merge" });
        case "release":
          return next({ status: "awaiting_deploy" });
        case "operate":
          return next({ status: "done" });
      }
      return fail();

    case "changes_requested": {
      if (state.status !== "running" || state.stage !== "verify") return fail();
      const reworks = state.reworks + 1;
      if (reworks > maxReworks) {
        return { ...state, status: "escalated", reworks, reason: `재구현 한도(${maxReworks}회)를 넘었습니다` };
      }
      return next({ stage: "implement", status: "queued", reworks });
    }

    case "pr_merged":
      return state.status === "awaiting_merge" ? next({ stage: "release", status: "queued" }) : fail();

    case "pr_closed":
      return state.status === "done" ? fail() : { ...state, status: "escalated", reason: "PR이 merge 없이 닫혔습니다" };

    case "deploy_approved":
      return state.status === "awaiting_deploy" ? next({ status: "done" }) : fail();

    case "escalate":
      return state.status === "done" ? fail() : { ...state, status: "escalated", reason: event.reason };

    case "retry":
      return state.status === "escalated" ? next({ status: "queued" }) : fail();
  }
}
