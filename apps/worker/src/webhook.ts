import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** X-Hub-Signature-256 검증 */
export function verifySignature(secret: string, rawBody: string, signature: string | undefined): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const repository = z.object({ full_name: z.string() });
const label = z.object({ name: z.string() });

const issuesLabeled = z.object({
  action: z.literal("labeled"),
  label,
  issue: z.object({
    number: z.number().int(),
    title: z.string(),
    body: z.string().nullable(),
    labels: z.array(label),
    pull_request: z.unknown().optional(),
  }),
  repository,
});

const pullRequestClosed = z.object({
  action: z.literal("closed"),
  pull_request: z.object({ number: z.number().int(), merged: z.boolean() }),
  repository,
});

export type WebhookCommand =
  | { type: "enqueue"; repo: string; issueNumber: number; title: string; body: string; labels: string[] }
  | { type: "pr_closed"; repo: string; prNumber: number; merged: boolean }
  | { type: "ignore"; reason: string };

/** GitHub 이벤트를 worker 명령으로 바꾼다. 부수 효과 없음. */
export function interpretWebhook(
  event: string | undefined,
  payload: unknown,
  options: { triggerLabel: string; repos: readonly string[] },
): WebhookCommand {
  if (event === "issues") {
    const parsed = issuesLabeled.safeParse(payload);
    if (!parsed.success) return { type: "ignore", reason: "issues 이벤트 중 labeled가 아님" };
    const { label: added, issue, repository: repo } = parsed.data;
    if (added.name !== options.triggerLabel) return { type: "ignore", reason: "트리거 label이 아님" };
    if (issue.pull_request !== undefined) return { type: "ignore", reason: "PR에는 작업을 접수하지 않음" };
    if (!options.repos.includes(repo.full_name)) return { type: "ignore", reason: `대상 레포가 아님: ${repo.full_name}` };
    return {
      type: "enqueue",
      repo: repo.full_name,
      issueNumber: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      labels: issue.labels.map((item) => item.name).filter((name) => name !== options.triggerLabel),
    };
  }

  if (event === "pull_request") {
    const parsed = pullRequestClosed.safeParse(payload);
    if (!parsed.success) return { type: "ignore", reason: "pull_request 이벤트 중 closed가 아님" };
    if (!options.repos.includes(parsed.data.repository.full_name)) return { type: "ignore", reason: "대상 레포가 아님" };
    return {
      type: "pr_closed",
      repo: parsed.data.repository.full_name,
      prNumber: parsed.data.pull_request.number,
      merged: parsed.data.pull_request.merged,
    };
  }

  return { type: "ignore", reason: `처리하지 않는 이벤트: ${event ?? "(없음)"}` };
}
