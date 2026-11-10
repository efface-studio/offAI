import { z } from "zod";

/**
 * 팀장이 작업 끝에 호출하는 report_result 커스텀 도구의 입력.
 * worker가 이 값으로 상태를 넘기고 PR을 만든다.
 */
export const reportSchema = z.object({
  outcome: z.enum(["completed", "changes_requested", "blocked"]),
  summary: z.string().min(1).max(2000),
  /** 구현 단계: push한 브랜치에 실제로 반영한 변경 */
  changes: z.array(z.string().max(300)).max(30).default([]),
  /** 원인/배경 */
  cause: z.array(z.string().max(300)).max(10).default([]),
  /** 실행한 검증 명령과 결과. 실행하지 않았으면 "미검증"으로 적는다. */
  verification: z.array(z.string().max(300)).max(20).default([]),
  /** 검증 단계에서 changes_requested 일 때 구현팀이 고칠 항목 */
  findings: z.array(z.string().max(500)).max(30).default([]),
  /** 운영 단계: 새 Issue로 만들 후속 작업 */
  followups: z
    .array(z.object({ title: z.string().min(1).max(120), body: z.string().min(1).max(4000) }))
    .max(5)
    .default([]),
  notes: z.array(z.string().max(300)).max(10).default([]),
  /** 기획 단계: 구현팀에 넘길 명세 (Markdown) */
  spec: z.string().max(8000).default(""),
  /** 기획 단계: 요구사항이 불분명할 때 Issue 작성자에게 물을 질문 */
  questions: z.array(z.string().max(500)).max(10).default([]),
});
export type Report = z.infer<typeof reportSchema>;

/** Managed Agents custom tool 정의용 JSON Schema */
export const REPORT_TOOL_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary"],
  properties: {
    outcome: {
      type: "string",
      enum: ["completed", "changes_requested", "blocked"],
      description: "completed: 단계 완료, changes_requested: 검증 단계에서 수정 요청, blocked: 진행 불가(사람 확인 필요)",
    },
    summary: { type: "string", description: "한국어 요약" },
    changes: { type: "array", items: { type: "string" }, description: "반영한 변경 목록" },
    cause: { type: "array", items: { type: "string" }, description: "원인/배경" },
    verification: { type: "array", items: { type: "string" }, description: "실행한 검증 명령과 결과" },
    findings: { type: "array", items: { type: "string" }, description: "수정 요청 항목 (file:line 포함)" },
    followups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body"],
        properties: { title: { type: "string" }, body: { type: "string" } },
      },
      description: "새로 만들 Issue 초안",
    },
    notes: { type: "array", items: { type: "string" } },
    spec: { type: "string", description: "기획 단계: 구현팀에 넘길 명세 (Markdown, 한국어)" },
    questions: { type: "array", items: { type: "string" }, description: "기획 단계: 사람에게 확인할 질문 (outcome 은 blocked)" },
  },
} as const;
