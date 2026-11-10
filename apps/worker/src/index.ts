import Anthropic from "@anthropic-ai/sdk";
import { createDb, loadOrg } from "@offai/db";
import Fastify from "fastify";
import { loadConfig } from "./config";
import { GitHub } from "./github";
import { Orchestrator } from "./orchestrator";
import { interpretWebhook, verifySignature } from "./webhook";

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const github = new GitHub({ appId: config.GITHUB_APP_ID, privateKey: config.GITHUB_APP_PRIVATE_KEY });
const anthropic = new Anthropic();

const app = Fastify({ logger: { level: "info" }, bodyLimit: 5 * 1024 * 1024 });
const log = {
  info: (message: string) => app.log.info(message),
  warn: (message: string) => app.log.warn(message),
  error: (message: string) => app.log.error(message),
};
const orchestrator = new Orchestrator({ db, anthropic, github, config, log });

// HMAC 검증에 원문이 필요하므로 JSON을 문자열 그대로 받는다
app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => done(null, body));

app.get("/healthz", async () => ({ ok: true, active: orchestrator.activeCount }));

app.post("/webhooks/github", async (request, reply) => {
  const raw = typeof request.body === "string" ? request.body : "";
  const signature = request.headers["x-hub-signature-256"];
  if (!verifySignature(config.GITHUB_WEBHOOK_SECRET, raw, typeof signature === "string" ? signature : undefined)) {
    return reply.code(401).send({ error: "invalid signature" });
  }
  const eventHeader = request.headers["x-github-event"];
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return reply.code(400).send({ error: "invalid json" });
  }
  const { org } = await loadOrg(db);
  const command = interpretWebhook(typeof eventHeader === "string" ? eventHeader : undefined, payload, {
    triggerLabel: config.OFFAI_TRIGGER_LABEL,
    repos: org.repos,
  });
  if (command.type === "ignore") {
    request.log.debug(command.reason);
  } else {
    await orchestrator.handleWebhook(command);
  }
  return reply.code(202).send({ ok: true });
});

let ticking = false;
const loop = setInterval(() => {
  if (ticking) return;
  ticking = true;
  orchestrator
    .tick()
    .catch((error: unknown) => log.error(`tick 실패: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      ticking = false;
    });
}, 5_000);

const operateLoop = setInterval(() => {
  orchestrator.scheduleOperate().catch((error: unknown) => log.error(`정기 점검 예약 실패: ${error instanceof Error ? error.message : String(error)}`));
}, 10 * 60_000);

const shutdown = async () => {
  clearInterval(loop);
  clearInterval(operateLoop);
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ port: config.WORKER_PORT, host: "0.0.0.0" });
