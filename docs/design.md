# offAI 설계 문서 (초안 v0.1)

> 상태: 검토 중 · 작성일: 2026-11-10 · 관련 Issue: #1

## 1. 목표

efface의 서비스(Portfolio, MOS, Mom-Work 등)를 **AI 에이전트 조직**이 나눠서 **구현 → 검증 → 배포 → 운영**하는 내부 도구를 만든다.

- 조직은 사람 회사처럼 **본부 → 팀 → 역할(에이전트)** 계층을 가진다.
- 에이전트는 실제 GitHub 레포에서 Issue, Branch, PR을 만들고 CI를 돌린다.
- **merge와 production 배포는 사람(xixn2)이 승인한다.** 에이전트에게 이 권한은 주지 않는다.

### 하지 않는 것 (v1 범위 밖)

- 외부 고객용 SaaS, 멀티테넌트, 과금
- 사람 승인 없이 진행되는 배포
- 에이전트끼리 자유롭게 대화하는 "가상 회사 시뮬레이션"
  - 모든 작업은 GitHub Issue 하나에서 시작해 PR 하나로 끝나는 단위로 제한한다.

---

## 2. 조직 모델

### 2.1 계층

```
회사 (efface)
└─ 본부 (Division)        예: 제품개발본부, 품질본부, 운영본부
   └─ 팀 (Team)           예: Web팀, Backend팀, QA팀, 릴리스팀, SRE팀
      └─ 역할 (Role)       예: 팀장, 구현 담당, 리뷰어, 테스터
```

| 단위 | 책임 | 실체 |
|---|---|---|
| 본부 | 작업 분류와 라우팅, 팀 간 조율, 본부 단위 예산 | offAI 컨트롤 플레인의 규칙과 설정 (에이전트가 아님) |
| 팀 | Issue 하나를 받아 PR 하나로 끝냄 | 에이전트 세션 1개 (팀장 = coordinator) |
| 역할 | 팀 안에서 맡은 일 하나 | 팀장이 일을 맡기는 하위 에이전트 |

**본부를 에이전트로 만들지 않는 이유**
- 본부가 하는 일(어느 팀에 보낼지, 예산이 남았는지, 다음 단계로 넘길지)은 규칙으로 처리할 수 있다. 여기에 LLM을 쓰면 비용과 예측 불가능성만 커진다.
- 실행 계층을 `팀 세션 → 역할 하위 에이전트` 2단으로 제한하면 추적과 비용 통제가 쉬워진다.
- 나중에 라우팅을 LLM으로 판단해야 할 상황이 생기면, 본부에 분류용 단일 호출을 추가한다.

### 2.2 기본 조직 (v1 제안)

| 본부 | 팀 | 역할 | 맡는 단계 |
|---|---|---|---|
| 제품개발본부 | Web팀 / Backend팀 / Mobile팀 | 팀장, 구현, 셀프리뷰 | 구현 |
| 품질본부 | QA팀 | 팀장, 테스트 작성, 회귀 검증 | 검증 |
| 품질본부 | 보안팀 | 보안 리뷰어 | 검증 (권한·인증 관련 변경일 때) |
| 운영본부 | 릴리스팀 | 릴리스 매니저 | 배포 준비 (staging) |
| 운영본부 | SRE팀 | 모니터링, 장애 분석 | 운영 (정기 실행) |

조직 구성은 코드가 아니라 **설정 데이터**로 관리한다. UI에서 본부, 팀, 역할을 추가하거나 수정할 수 있어야 한다.

### 2.3 역할 정의 항목

```ts
type RoleDefinition = {
  id: string;
  teamId: string;
  name: string;              // "구현 담당"
  systemPrompt: string;      // 역할 지침 (프로젝트 CLAUDE.md 규칙을 함께 주입)
  model: "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";
  effort: "low" | "medium" | "high" | "xhigh";
  tools: ToolGrant[];        // 허용 도구 (아래 4장 권한 참고)
  repoScopes: string[];      // 접근 가능한 레포 (예: "efface-studio/Portfolio")
};
```

---

## 3. 작업 라이프사이클

작업 하나 = **GitHub Issue 하나**. offAI는 Issue 상태를 기준으로 단계를 넘긴다.

```
[1 접수]  사람이 offAI에서 요청하거나 GitHub Issue에 label을 붙임
   │      → 본부 라우팅 규칙으로 담당 팀 결정
   ▼
[2 구현]  개발팀 세션: Branch 생성 → 코드 수정 → lint/typecheck/test → PR 생성
   │      → PR 본문은 리포 규칙 양식을 따름, Closes #N
   ▼
[3 검증]  QA팀(+필요하면 보안팀) 세션: PR 체크아웃 → 테스트 보강·실행 → PR 리뷰 코멘트
   │      → 실패하면 [2]로 되돌림 (최대 N회, 넘으면 사람에게 넘김)
   ▼
[4 승인]  ★ 사람 게이트: xixn2가 PR 검토 후 merge
   ▼
[5 배포]  릴리스팀: staging 배포·스모크 테스트 → production 배포 요청 생성
   │      ★ 사람 게이트: production 배포 승인
   ▼
[6 운영]  SRE팀: 정해진 주기로 헬스체크·로그 확인 → 이상이 있으면 새 Issue 생성 → [1]로
```

### 단계별 상태 (offAI DB)

`queued → in_progress → awaiting_review → changes_requested → awaiting_human → merged → deploying → done | failed | escalated`

- 각 단계의 실행 기록(세션 ID, 사용 토큰, 비용, 결과 요약, 만든 PR/코멘트 링크)을 저장한다.
- `escalated`: 재시도 한도 초과, 예산 초과, 에이전트가 판단을 요청한 경우. 사람이 처리한다.

---

## 4. 권한과 안전 장치

전역 규칙(`main` 직접 push 금지, merge는 사람만, 파괴적 작업은 확인 후 실행)을 **프롬프트가 아니라 권한으로 강제**한다. 프롬프트만으로 막으면 언젠가 뚫린다.

### 4.1 GitHub 권한

- **GitHub App**을 `efface-studio` org에 설치해서 사용한다. 개인 토큰은 쓰지 않는다.
  - 권한: Contents(write), Issues(write), Pull requests(write), Checks(read)
  - 레포별로 설치 범위를 제한한다.
- `main` 브랜치 보호 규칙 (모든 대상 레포에 적용)
  - PR 필수, CI 통과 필수, 리뷰 승인 필수
  - **GitHub App은 bypass 목록에 넣지 않는다.** 앱 권한으로는 merge가 불가능해야 한다.
- 실행할 때마다 짧게 유효한 installation token을 발급한다. 토큰은 에이전트 컨테이너에 평문으로 남기지 않는다 (5장 vault 참고).

### 4.2 도구 권한 정책

| 도구/동작 | 정책 |
|---|---|
| 파일 읽기·수정, lint/test 실행 | 자동 허용 |
| `git push` (작업 브랜치) | 자동 허용 |
| `git push` (`main`), force push, `reset --hard` | **차단** |
| 의존성 추가 (`package.json` 변경) | 사람 확인 |
| DB 마이그레이션, 환경변수/시크릿 변경 | 사람 확인 |
| production 배포 | **에이전트 권한 없음** (사람 버튼) |

### 4.3 비용 통제

- 세션마다 비용 상한을 둔다 (예: 구현 $10, 검증 $5).
- 본부별 월 예산을 두고, 다 쓰면 새 작업을 `queued`에서 멈춘다.
- 재시도 한도: 검증 실패 후 재구현은 최대 2회까지만 한다.

---

## 5. 기술 스택 제안

### 5.1 에이전트 실행 방식 비교

| | Managed Agents (beta) | Claude Agent SDK | Messages API + Tool Runner |
|---|---|---|---|
| 에이전트 루프 | Anthropic이 실행 | SDK가 실행 (우리 서버) | SDK가 실행 (우리 서버) |
| 코드 실행 환경 | 세션마다 Anthropic 호스팅 컨테이너 | 우리가 호스팅 (격리 필요) | 우리가 모든 도구를 구현 |
| 기본 도구 (bash, 파일 수정) | 있음 | 있음 (Claude Code와 같음) | 없음 |
| 팀장 → 하위 에이전트 위임 | `multiagent` 설정으로 지원 | subagents 지원 | 직접 구현 |
| 권한 정책 | `always_allow` / `always_ask` / `auto` | hooks, 권한 설정 | 직접 구현 |
| 시크릿 | vault (컨테이너에는 placeholder만 들어감) | 직접 관리 | 직접 관리 |
| 정기 실행 (SRE팀) | scheduled deployments | cron 직접 구성 | cron 직접 구성 |
| 비용 상한 | 세션 budget (달러 단위 하드 캡) | 직접 구현 | 직접 구현 |

### 5.2 추천: Managed Agents + 자체 컨트롤 플레인

**추천 이유**
1. 에이전트가 임의의 코드를 실행하므로 **실행 환경 격리**가 가장 중요하다. 세션마다 새 컨테이너가 뜨는 구조가 이 조건을 그대로 충족한다. 이 Mac에서 직접 실행하면 운영 중인 서비스(화소 Shop 등)와 같은 머신을 쓰게 되어 위험하다.
2. 팀장 → 역할 위임, 권한 정책, vault, 비용 상한, 정기 실행을 이미 제공하므로 4장의 안전 장치를 직접 구현할 부분이 줄어든다.
3. 에이전트 설정을 버전 관리되는 파일로 두고 `ant apply`로 동기화할 수 있다. 그래서 역할 프롬프트 변경도 PR로 리뷰할 수 있다.

**리스크와 대안**
- beta 기능이므로 API가 바뀔 수 있다. 실행 계층을 `AgentRunner` 인터페이스 뒤에 숨기고, PoC에서 문제가 생기면 **Claude Agent SDK + 자체 컨테이너(Docker)**로 바꿀 수 있게 설계한다.
- 로컬 파일이나 내부망에 접근해야 하는 작업이 있다면 Managed Agents 컨테이너에서 접근할 수 없다. v1 대상 서비스 중 그런 작업이 있는지 확인이 필요하다.

### 5.3 전체 구성

```
┌──────────── offAI (efface-studio/offAI) ────────────┐
│  web: Next.js (App Router) + TypeScript             │
│   - 조직 관리 UI (본부/팀/역할)                       │
│   - 작업 보드, 실행 로그, 승인 화면                    │
│  worker: Node + TypeScript                           │
│   - GitHub webhook 수신 → 라우팅 → 세션 시작           │
│   - 세션 이벤트 스트림 수신 → 상태/비용 기록           │
│  db: PostgreSQL                                      │
│   - 조직 설정, 작업, 실행 기록, 승인 내역               │
└──────────────┬─────────────────────┬─────────────────┘
               │ @anthropic-ai/sdk    │ GitHub App
               ▼                      ▼
     Claude Managed Agents      GitHub (efface-studio/*)
     (팀 세션 + 역할 하위 에이전트)   Issue / PR / Actions CI
```

- **web과 worker를 나누는 이유:** 에이전트 세션은 수십 분 동안 실행되고 이벤트 스트림을 계속 받아야 한다. 요청-응답 구조인 Next.js 서버리스 함수에는 맞지 않는다.
- 작업 큐는 처음에는 PostgreSQL 테이블로 처리한다 (별도 큐 서비스는 필요해질 때 추가).
- 모노레포: `apps/web`, `apps/worker`, `packages/core`(도메인 타입, 라우팅 규칙), `agents/`(에이전트 설정 파일)

### 5.4 모델 배정 (초안, PoC에서 측정 후 조정)

| 역할 | 모델 | effort |
|---|---|---|
| 팀장 (계획, 위임, 결과 종합) | `claude-opus-5-5` | `high` |
| 구현 담당 | `claude-opus-5-5` | `high` |
| 테스트·리뷰 | `claude-sonnet-5-5` | `medium` |
| 로그·코드 탐색 (읽기 위주) | `claude-haiku-5-5` | `low` |

- 비용은 PR 1건을 끝까지 처리하는 데 드는 비용으로 판단한다. 요청 한 번의 단가로 판단하지 않는다.
- `claude-opus-5-5`의 effort 기본값은 `medium`이므로 반드시 명시한다.

---

## 6. MVP 범위와 마일스톤

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| M0 PoC | 레포 1개(Portfolio)에 개발팀 세션 1개. Issue → PR 생성까지 | 실제 PR 1건 생성, `main` push 차단 확인, 비용 측정 |
| M1 컨트롤 플레인 | DB 스키마, worker, GitHub App, webhook, 작업 상태 머신 | label 붙인 Issue가 자동으로 PR까지 진행 |
| M2 검증 단계 | QA팀 세션, 실패 시 재구현 루프, 사람 승인 대기 | 검증 실패 → 재구현 → 통과 흐름 동작 |
| M3 조직 UI | 본부/팀/역할 편집, 작업 보드, 실행 로그·비용 화면 | UI에서 팀 추가 → 실제 라우팅에 반영 |
| M4 배포·운영 | 릴리스팀(staging), SRE팀 정기 점검 → Issue 자동 생성 | staging 배포 + 정기 점검 1주 운영 |

---

## 7. 결정이 필요한 사항

1. **v1 대상 레포**: Portfolio부터 시작하는 안을 제안한다. 다른 레포를 우선할지 결정이 필요하다.
2. **offAI 호스팅 위치**: worker가 계속 떠 있어야 한다. 이 Mac은 운영 서비스와 겹치므로 별도 서버(또는 컨테이너 호스팅)를 제안한다.
3. **Managed Agents 사용 가능 여부**: 계정에서 beta 접근과 multiagent 기능을 쓸 수 있는지 M0에서 확인한다.
4. **월 예산 상한**: 본부별 기본 예산을 정해야 한다.
5. **보안팀 리뷰 트리거 조건**: 인증·권한·결제 관련 경로 변경 시 자동 추가하는 안을 제안한다.

## 8. M0에서 검증할 가정

- [ ] Managed Agents 세션 컨테이너에서 대상 레포 clone, install, test가 가능한가
- [ ] vault 자격 증명으로 GitHub push와 PR 생성이 가능한가
- [ ] 팀장 → 역할 하위 에이전트 위임 구조가 팀 단위로 충분한가 (위임 깊이 제한 확인)
- [ ] 브랜치 보호 규칙으로 앱의 `main` push와 merge가 실제로 막히는가
- [ ] PR 1건당 비용과 소요 시간
