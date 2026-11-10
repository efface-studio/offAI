/**
 * 에이전트 bash 명령 권한 정책.
 * Managed Agents에서 bash 도구를 always_ask로 두고, worker가 이 정책으로 판정한다.
 * - allow: 바로 허용
 * - deny: 거부 (사람에게도 묻지 않음)
 * - ask: 사람 승인함으로 보냄
 *
 * 마지막 방어선은 GitHub 브랜치 보호 규칙이다. 이 정책은 그 앞에서 실수를 줄이는 용도다.
 */
export type Decision = "allow" | "deny" | "ask";

export type PolicyResult = { decision: Decision; reason: string };

type Rule = { pattern: RegExp; decision: Decision; reason: string };

const RULES: Rule[] = [
  { pattern: /\bgit\s+push\b[^\n]*(?:\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/, decision: "deny", reason: "force push 금지" },
  { pattern: /\bgit\s+push\b[^\n;&|]*\s(?:\S*:)?(?:refs\/heads\/)?(?:main|master)(?=\s|$|;|&|\|)/, decision: "deny", reason: "main 직접 push 금지" },
  { pattern: /\bgit\s+push\b[^\n]*\s--(?:all|mirror|delete)\b/, decision: "deny", reason: "전체/삭제 push 금지" },
  { pattern: /\bgit\s+push\b[^\n]*\s:\S+/, decision: "deny", reason: "원격 브랜치 삭제 금지" },
  { pattern: /\bgit\s+reset\s+--hard\b/, decision: "deny", reason: "reset --hard 금지" },
  { pattern: /\bgit\s+clean\s+-\w*f/, decision: "deny", reason: "git clean 금지" },
  { pattern: /\bgit\s+branch\s+-D\b/, decision: "deny", reason: "강제 브랜치 삭제 금지" },
  { pattern: /\bgh\s+pr\s+merge\b/, decision: "deny", reason: "merge는 사람만 한다" },
  { pattern: /\bgh\s+repo\s+(?:delete|archive)\b/, decision: "deny", reason: "레포 삭제/보관 금지" },
  { pattern: /\bgh\s+api\b[^\n]*\/merges?\b/, decision: "deny", reason: "merge는 사람만 한다" },
  { pattern: /\brm\s+-\w*r\w*f?\s+(?:\/|~|\$HOME|\*)(?:\s|$)/, decision: "deny", reason: "대량 삭제 금지" },
  { pattern: /\b(?:wrangler|vercel|fly|netlify)\s+(?:deploy|publish)\b[^\n]*(?:prod|production)?/, decision: "deny", reason: "배포는 사람 승인 후 별도 경로로 한다" },
  { pattern: /\bdrizzle-kit\s+(?:push|migrate)\b|\bprisma\s+(?:migrate\s+deploy|db\s+push)\b/, decision: "ask", reason: "DB 스키마 적용은 사람 확인" },
  { pattern: /\b(?:DROP|TRUNCATE)\s+(?:TABLE|DATABASE|SCHEMA)\b/i, decision: "deny", reason: "DB 삭제 금지" },
  { pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:add|install|i)\s+(?!-)\S/, decision: "ask", reason: "의존성 추가는 사람 확인" },
  { pattern: /\bcurl\b[^\n]*\|\s*(?:ba|z)?sh\b/, decision: "deny", reason: "원격 스크립트 실행 금지" },
];

export function evaluateCommand(command: string): PolicyResult {
  // 여러 명령이 이어진 경우 가장 엄격한 판정을 따른다.
  let result: PolicyResult = { decision: "allow", reason: "허용 목록 외 위험 패턴 없음" };
  for (const rule of RULES) {
    if (!rule.pattern.test(command)) continue;
    if (rule.decision === "deny") return { decision: "deny", reason: rule.reason };
    result = { decision: "ask", reason: rule.reason };
  }
  return result;
}
