import "server-only";
import { DEFAULT_ORG, type Org, type Stage, type TaskStatus } from "@offai/core";

/** 작업 목록 화면에서 쓰는 작업 요약 */
export type TaskSummary = {
  id: string;
  repo: string;
  issueNumber: number;
  title: string;
  stage: Stage;
  status: TaskStatus;
  teamId: string | null;
  prNumber: number | null;
  reworks: number;
  reason: string | null;
  spentCents: number;
  updatedAt: Date;
};

export type ApprovalSummary = {
  id: string;
  taskId: string;
  taskTitle: string;
  teamId: string;
  command: string;
  reason: string;
  requestedAt: Date;
};

/**
 * 데이터 접근 계층. DB 연결(#4) 전에는 기본 조직과 빈 작업 목록을 돌려준다.
 */
export async function getOrg(): Promise<Org> {
  return DEFAULT_ORG;
}

export async function getTasks(): Promise<TaskSummary[]> {
  return [];
}

export async function getPendingApprovals(): Promise<ApprovalSummary[]> {
  return [];
}

export async function getMonthlySpend(): Promise<Map<string, number>> {
  return new Map();
}
