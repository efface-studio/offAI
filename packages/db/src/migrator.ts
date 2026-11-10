import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db } from "./index";

/**
 * packages/db/drizzle 의 마이그레이션을 적용한다.
 * 파일 경로를 쓰므로 web 번들에 들어가지 않도록 별도 진입점(@offai/db/migrator)으로 둔다.
 */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
}
