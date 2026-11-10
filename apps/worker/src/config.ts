import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  GITHUB_APP_ID: z.string().min(1),
  /** PEM. .env 한 줄로 넣을 때는 줄바꿈을 \n 으로 적는다. */
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).transform((value) => value.replace(/\\n/g, "\n")),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  OFFAI_TRIGGER_LABEL: z.string().min(1).default("offai"),
  OFFAI_ASSIGNEE: z.string().min(1).default("xixn2"),
  WORKER_PORT: z.coerce.number().int().positive().default(4445),
  MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  /** 0 이면 정기 점검을 만들지 않는다 */
  OPERATE_INTERVAL_HOURS: z.coerce.number().min(0).default(0),
  /** 한 세션의 최대 실행 시간 (분) */
  SESSION_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(90),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    // 값은 출력하지 않는다 (시크릿 포함 가능)
    throw new Error(`worker 환경 변수가 올바르지 않습니다: ${fields}`);
  }
  return parsed.data;
}
