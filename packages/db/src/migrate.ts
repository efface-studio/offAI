import { createDb } from "./index";
import { runMigrations } from "./migrator";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 이 필요합니다");

const { db, close } = createDb(url, { max: 1 });
await runMigrations(db);
await close();
console.log("마이그레이션 완료");
