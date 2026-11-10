# offAI 실행 안내

## 구성

| 구성 요소 | 위치 | 포트 |
|---|---|---|
| web 콘솔 (조직도, 자리 배치도, 작업, 승인함, 설정) | `apps/web` | 4444 |
| worker (GitHub webhook, 에이전트 세션 실행) | `apps/worker` | 4445 |
| DB 스키마·마이그레이션 | `packages/db` | Postgres 55433 (로컬) |
| 도메인 규칙 (조직, 라우팅, 상태 머신, 명령 정책) | `packages/core` | - |

## 1. 로컬 실행 (콘솔만)

```bash
pnpm install
docker compose -p offai up -d --wait
cp .env.example .env            # DATABASE_URL 만 있어도 콘솔은 동작한다
pnpm --filter @offai/db db:migrate
pnpm --filter @offai/db db:seed # 기본 조직 저장
DATABASE_URL=postgres://offai:offai_dev@localhost:55433/offai pnpm --filter @offai/web dev
```

`DATABASE_URL` 없이 web 을 띄우면 기본 조직을 읽기 전용으로 보여주는 미리보기 모드가 된다.

## 2. GitHub App 만들기 (efface-studio org)

1. Organization settings → Developer settings → GitHub Apps → New GitHub App
2. Webhook URL: `https://<worker 주소>/webhooks/github`, Secret: 임의의 긴 문자열 → `GITHUB_WEBHOOK_SECRET`
3. Repository permissions
   - Contents: Read and write
   - Issues: Read and write
   - Pull requests: Read and write
   - Metadata: Read-only
4. Subscribe to events: **Issues**, **Pull request**
5. 앱 생성 후 App ID → `GITHUB_APP_ID`, Private key 생성 → `GITHUB_APP_PRIVATE_KEY`
6. 앱을 대상 레포(처음에는 `efface-studio/Portfolio`)에만 설치한다
7. 대상 레포에 `offai` label 을 만든다

## 3. 브랜치 보호 (필수)

에이전트가 merge 하거나 main 에 push 하지 못하게 하는 최종 방어선이다. 대상 레포마다 설정한다.

- Settings → Branches → `main` 보호 규칙
  - Require a pull request before merging, Require approvals 1
  - Require status checks to pass
  - Do not allow bypassing the above settings
- GitHub App 을 bypass 목록에 **넣지 않는다**

worker 의 명령 정책(`packages/core/src/policy.ts`)도 main push·force push·`gh pr merge` 를 거부하지만, 정책은 실수 방지용이고 최종 차단은 브랜치 보호가 한다.

## 4. Managed Agents 준비

```bash
# ANTHROPIC_API_KEY 또는 `ant auth login` 이 필요하다
pnpm --filter @offai/worker setup:agents
```

- environment 하나를 만들고(이미 있으면 재사용) 조직의 직원 36명을 agent 로 동기화한다
- 이후 콘솔에서 조직을 수정하면 worker 가 다음 주기에 바뀐 직원만 새 버전으로 갱신한다

## 5. worker 실행

```bash
pnpm --filter @offai/worker dev
```

webhook 을 로컬에서 받으려면 cloudflared 등으로 4445 포트를 외부에 연결한다.

## 작업 흐름

1. 대상 레포 Issue 에 `offai` label 을 붙인다
2. **기획**: 기획팀이 명세를 쓰고, UI 작업이면 디자인팀이 화면 명세를 더한다 → Issue 코멘트. 모호하면 질문을 남기고 멈춘다
3. **구현**: Web/Backend 팀이 브랜치에서 구현·push → offAI 가 PR 생성
4. **검증**: QA팀 + (경로·label 에 따라) 보안팀, 법무팀 → 수정 요청이면 구현으로 되돌림 (최대 2회)
5. **사람**: PR 검토 후 merge
6. **배포 준비**: 릴리스팀이 빌드 확인, 배포 요청서를 PR 에 남김
7. **사람**: production 배포 후 콘솔에서 '배포 완료 기록'
8. **운영**: `OPERATE_INTERVAL_HOURS` 마다 운영팀 정기 점검 → 문제는 `offai` label 없는 Issue 로 생성 (사람이 label 을 붙여야 진행)

## 비용 통제

- 팀 세션마다 Managed Agents session budget(하드 상한)을 건다 — 팀 화면의 '세션 상한'
- 본부 월 예산이 세션 상한보다 적게 남으면 세션을 시작하지 않고 사람에게 넘긴다
- 직급별 기본 모델: 팀장 Opus 5.5 high, 책임 Opus 5.5 medium, 선임 Sonnet 5.5 medium, 사원 Haiku 5.5 low
- workflow run(대규모 병렬 실행)은 끄고, 팀장이 자기 팀원에게만 일을 맡긴다
