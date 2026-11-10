import type { Org, Role } from "./org";

const RULES = `작업 규칙:
- 작업 브랜치에서만 커밋하고 push한다. main에는 절대 push하지 않는다.
- force push, git reset --hard, git clean, 대량 삭제를 하지 않는다.
- 레포의 CLAUDE.md / AGENTS.md / README의 규칙을 먼저 읽고 따른다.
- 존재하지 않는 API나 패키지를 추측해서 쓰지 않는다. 확인하고 쓴다.
- 요청 범위를 넘는 리팩터링을 하지 않는다.
- 검증하지 않은 것을 검증했다고 보고하지 않는다.`;

function role(r: Omit<Role, "instructions"> & { instructions: string }): Role {
  return { ...r, instructions: `${r.instructions}\n\n${RULES}` };
}

/** v1 기본 조직. web 콘솔에서 수정하면 DB 값이 우선한다. */
export const DEFAULT_ORG: Org = {
  name: "efface",
  repos: ["efface-studio/Portfolio"],
  securityPaths: ["**/auth/**", "**/middleware.*", "**/*.env*", "**/payment*/**", ".github/workflows/**"],
  maxReworks: 2,
  divisions: [
    {
      id: "product",
      name: "제품개발본부",
      mission: "Issue를 받아 동작하는 코드와 PR로 만든다",
      monthlyBudgetCents: 30_000,
      teams: [
        {
          id: "web",
          name: "Web팀",
          stage: "implement",
          labels: ["🖥️ web", "🎨 design"],
          sessionBudgetCents: 1_000,
          roles: [
            role({
              id: "web-lead",
              name: "팀장",
              lead: true,
              responsibility: "작업 계획, 구현, 팀원 위임, 결과 종합",
              instructions:
                "너는 Web팀 팀장이다. Issue를 읽고 계획을 세운 뒤 직접 구현한다. 변경 파일과 지켜야 할 조건을 리뷰어에게, 테스트 대상과 명령을 테스터에게 맡기고, 돌아온 지적은 코드와 대조해 확인한 뒤 반영한다. 끝나면 lint/typecheck/test/build 결과를 포함해 report_result로 보고한다.",
              model: "claude-opus-5-5",
              effort: "high",
              tools: "full",
            }),
            role({
              id: "web-reviewer",
              name: "리뷰어",
              lead: false,
              responsibility: "변경 코드 셀프리뷰 (읽기 전용)",
              instructions:
                "지정된 파일만 리뷰한다. 버그, 타입 안전성, 접근성, 반응형 문제를 찾고 각 지적을 file:line, 문제, 수정안으로 보고한다. 찾은 게 없으면 없다고 말한다. 코드를 고치지 않는다.",
              model: "claude-sonnet-5-5",
              effort: "medium",
              tools: "read_only",
            }),
            role({
              id: "web-tester",
              name: "테스터",
              lead: false,
              responsibility: "테스트 작성과 실행",
              instructions:
                "주어진 동작을 검증하는 테스트를 작성하고 주어진 명령으로 실행한다. 통과/실패, 핵심 출력, 추가한 파일 경로를 보고한다. 테스트가 아닌 코드는 고치지 않는다.",
              model: "claude-sonnet-5-5",
              effort: "medium",
              tools: "full",
            }),
          ],
        },
        {
          id: "backend",
          name: "Backend팀",
          stage: "implement",
          labels: ["⚙️ backend", "🗄️ database"],
          sessionBudgetCents: 1_000,
          roles: [
            role({
              id: "backend-lead",
              name: "팀장",
              lead: true,
              responsibility: "API·데이터 변경 구현과 위임",
              instructions:
                "너는 Backend팀 팀장이다. API 요청/응답 형식과 DB 스키마는 기존 타입과 호출 코드로 확인한 뒤 바꾼다. 마이그레이션이 필요하면 직접 실행하지 말고 파일만 만들고 보고서에 적는다. 끝나면 report_result로 보고한다.",
              model: "claude-opus-5-5",
              effort: "high",
              tools: "full",
            }),
            role({
              id: "backend-reviewer",
              name: "리뷰어",
              lead: false,
              responsibility: "권한 검증·입력 검증·동시성 리뷰 (읽기 전용)",
              instructions:
                "지정된 파일만 리뷰한다. 인가 누락, 입력 검증, injection, 트랜잭션/동시성 문제를 file:line과 재현 조건, 수정안으로 보고한다. 코드를 고치지 않는다.",
              model: "claude-sonnet-5-5",
              effort: "medium",
              tools: "read_only",
            }),
          ],
        },
      ],
    },
    {
      id: "quality",
      name: "품질본부",
      mission: "PR이 요구사항을 만족하고 기존 동작을 깨지 않는지 확인한다",
      monthlyBudgetCents: 15_000,
      teams: [
        {
          id: "qa",
          name: "QA팀",
          stage: "verify",
          labels: [],
          sessionBudgetCents: 500,
          roles: [
            role({
              id: "qa-lead",
              name: "팀장",
              lead: true,
              responsibility: "PR 검증 계획, 테스트 보강, 판정",
              instructions:
                "너는 QA팀 팀장이다. PR 브랜치에서 Issue의 요구사항을 하나씩 확인하고, lint/typecheck/test/build를 실행하고, 빠진 테스트를 보강한다. 판정은 pass 또는 changes_requested 중 하나로 report_result에 적고, changes_requested면 구현팀이 바로 고칠 수 있게 file:line 단위로 근거를 적는다.",
              model: "claude-opus-5-5",
              effort: "high",
              tools: "full",
            }),
            role({
              id: "qa-regression",
              name: "회귀 검증",
              lead: false,
              responsibility: "변경 영향 범위 탐색 (읽기 전용)",
              instructions:
                "변경된 파일을 import하거나 호출하는 곳을 찾아 영향을 받을 수 있는 동작 목록을 보고한다. 코드를 고치지 않는다.",
              model: "claude-haiku-5-5",
              effort: "low",
              tools: "read_only",
            }),
          ],
        },
        {
          id: "security",
          name: "보안팀",
          stage: "verify",
          labels: ["🔒 security"],
          sessionBudgetCents: 500,
          roles: [
            role({
              id: "security-lead",
              name: "보안 리뷰어",
              lead: true,
              responsibility: "인증·인가·시크릿·입력 검증 리뷰",
              instructions:
                "너는 보안팀 리뷰어다. PR 변경분에서 인가 우회, XSS, injection, 시크릿 노출, 안전하지 않은 의존성을 찾는다. 판정은 pass 또는 changes_requested로 report_result에 적는다. 실제 공격 코드는 작성하지 않는다.",
              model: "claude-opus-5-5",
              effort: "high",
              tools: "read_only",
            }),
          ],
        },
      ],
    },
    {
      id: "operations",
      name: "운영본부",
      mission: "merge된 변경을 안전하게 내보내고 서비스 상태를 지켜본다",
      monthlyBudgetCents: 10_000,
      teams: [
        {
          id: "release",
          name: "릴리스팀",
          stage: "release",
          labels: [],
          sessionBudgetCents: 300,
          roles: [
            role({
              id: "release-manager",
              name: "릴리스 매니저",
              lead: true,
              responsibility: "릴리스 노트, staging 확인, production 배포 요청서",
              instructions:
                "너는 릴리스 매니저다. merge된 커밋으로 릴리스 노트를 쓰고, staging 배포 결과와 스모크 테스트를 확인한다. production 배포는 직접 하지 않는다. 배포 요청서(변경 요약, 위험, 롤백 방법)를 report_result로 보고한다.",
              model: "claude-sonnet-5-5",
              effort: "medium",
              tools: "full",
            }),
          ],
        },
        {
          id: "sre",
          name: "SRE팀",
          stage: "operate",
          labels: ["☁️ infra"],
          sessionBudgetCents: 300,
          roles: [
            role({
              id: "sre-lead",
              name: "SRE",
              lead: true,
              responsibility: "헬스체크, 로그·CI 상태 점검, 이상 시 Issue 제안",
              instructions:
                "너는 SRE다. 서비스 헬스체크와 최근 CI 실패를 점검한다. 문제를 찾으면 증상, 근거, 추정 원인을 report_result의 followups에 Issue 초안으로 남긴다. 운영 환경에 변경을 가하지 않는다.",
              model: "claude-sonnet-5-5",
              effort: "medium",
              tools: "read_only",
            }),
          ],
        },
      ],
    },
  ],
};
