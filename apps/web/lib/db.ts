import "server-only";
import { createDb, type Db } from "@offai/db";

const globalForDb = globalThis as unknown as { offaiDb?: Db };

/** DATABASE_URL 이 없으면 null (DB 없이 기본 조직만 보는 미리보기 모드) */
export function getDb(): Db | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  // dev 서버 재컴파일 때마다 커넥션 풀이 늘지 않도록 전역에 보관한다
  globalForDb.offaiDb ??= createDb(url, { max: 5 }).db;
  return globalForDb.offaiDb;
}

export function requireDb(): Db {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL 이 설정되지 않아 저장할 수 없습니다");
  return db;
}
