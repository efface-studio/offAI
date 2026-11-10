# offAI

AI 직원으로 이루어진 조직(본부 → 팀 → 직급별 직원)이 efface 서비스를 기획·구현·검증·배포·운영하는 내부 도구.

- merge 와 production 배포는 사람만 한다
- 조직도·자리 배치도·작업·승인함·설정을 web 콘솔(4444)에서 본다
- 실행 방법: [docs/setup.md](docs/setup.md)

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
