/**
 * 최초 1회 설정: Managed Agents environment 를 만들고 조직의 역할을 agent 로 동기화한다.
 * 다시 실행해도 안전하다 (environment 는 이미 있으면 재사용, agent 는 바뀐 것만 갱신).
 */
import Anthropic from "@anthropic-ai/sdk";
import { createDb, getSetting, loadOrg, setSetting } from "@offai/db";
import { syncAgents } from "./agents";
import { ENVIRONMENT_SETTING } from "./orchestrator";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 이 필요합니다");

const { db, close } = createDb(url, { max: 1 });
const client = new Anthropic();

let environmentId = await getSetting(db, ENVIRONMENT_SETTING);
if (!environmentId) {
  const environment = await client.beta.environments.create({
    name: "offai",
    config: {
      type: "cloud",
      // 패키지 설치와 GitHub(git proxy)만 필요하다. 웹 도구는 agent 에서 꺼 둔다.
      networking: { type: "limited", allow_package_managers: true, allow_mcp_servers: false },
    },
  });
  environmentId = environment.id;
  await setSetting(db, ENVIRONMENT_SETTING, environmentId);
  console.log(`environment 생성: ${environmentId}`);
} else {
  console.log(`environment 재사용: ${environmentId}`);
}

const { version, org } = await loadOrg(db);
await syncAgents(client, db, org, (message) => console.log(message));
await setSetting(db, "synced_org_version", String(version));
console.log(`조직 v${version} 동기화 완료`);
await close();
