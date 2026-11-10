import { DEFAULT_ORG } from "@offai/core";
import { createDb, loadOrg, saveOrg } from "./index";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 이 필요합니다");

const { db, close } = createDb(url, { max: 1 });
const current = await loadOrg(db);
if (current.version === 0) {
  const version = await saveOrg(db, DEFAULT_ORG, "seed");
  console.log(`기본 조직을 저장했습니다 (version ${version})`);
} else {
  console.log(`이미 조직 설정이 있습니다 (version ${current.version}) — 건너뜀`);
}
await close();
