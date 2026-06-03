import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "agent-ai-smoke-"));
const port = 19000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/server.mjs"], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    NODE_ENV: "development",
    ALLOW_DEMO: "true",
    ADMIN_EMAILS: "boss@ares.test",
    AI_PROVIDER: "disabled",
    AI_USER_DAILY_LIMIT: "1",
    AI_ORG_DAILY_LIMIT: "1",
    ATTACHMENT_MAX_BYTES: "1024",
    ATTACHMENT_ALLOWED_TYPES: "image/png,text/plain"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk;
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk;
});

function stop() {
  if (!server.killed) server.kill("SIGTERM");
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // Retry until the server is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`server did not start\n${serverOutput}`);
}

function makeClient() {
  let cookie = "";
  return async function request(pathname, options = {}) {
    const response = await fetch(base + pathname, {
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(options.headers || {})
      },
      ...options
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`${pathname} ${response.status}: ${body?.error || text}`);
    return body;
  };
}

async function expectStatus(action, status, message) {
  try {
    await action();
  } catch (err) {
    if (err.message.includes(` ${status}:`)) return;
    throw err;
  }
  throw new Error(message);
}

try {
  await waitForServer();
  const client = makeClient();
  await client("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "boss@ares.test", password: "ares123" })
  });
  const state = await client("/api/state");
  const agent = state.agents[0];
  const contact = agent?.contacts?.[0];
  if (!agent || !contact) throw new Error("seed data did not provide an agent conversation");

  await client(`/api/conversations/${contact.conversationId}/instructions`, {
    method: "POST",
    body: JSON.stringify({ agentId: agent.id, text: "第一次 Agent 调用应该成功" })
  });

  await expectStatus(
    () => client(`/api/conversations/${contact.conversationId}/instructions`, {
      method: "POST",
      body: JSON.stringify({ agentId: agent.id, text: "第二次 Agent 调用应该被额度拦截" })
    }),
    429,
    "AI quota did not block the second instruction"
  );

  await client(`/api/conversations/${contact.conversationId}/attachments`, {
    method: "POST",
    body: JSON.stringify({
      agentId: agent.id,
      kind: "图片",
      filename: "smoke.png",
      mimeType: "image/png",
      sizeBytes: 512
    })
  });

  await expectStatus(
    () => client(`/api/conversations/${contact.conversationId}/attachments`, {
      method: "POST",
      body: JSON.stringify({
        agentId: agent.id,
        kind: "图片",
        filename: "too-large.png",
        mimeType: "image/png",
        sizeBytes: 1025
      })
    }),
    413,
    "attachment size guard did not reject an oversize file"
  );

  await expectStatus(
    () => client(`/api/conversations/${contact.conversationId}/attachments`, {
      method: "POST",
      body: JSON.stringify({
        agentId: agent.id,
        kind: "文件",
        filename: "blocked.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512
      })
    }),
    415,
    "attachment type guard did not reject an unsupported file"
  );

  const overview = await client("/api/admin/overview");
  if (overview.counts.aiCalls24h !== 1) throw new Error("AI success count is incorrect");
  if (overview.counts.aiBlocked24h !== 1) throw new Error("AI quota block count is incorrect");
  if (overview.counts.fileUploads24h !== 1) throw new Error("file upload count is incorrect");

  console.log(JSON.stringify({
    ok: true,
    base,
    dataDir,
    aiCalls24h: overview.counts.aiCalls24h,
    aiBlocked24h: overview.counts.aiBlocked24h,
    fileUploads24h: overview.counts.fileUploads24h
  }, null, 2));
} finally {
  stop();
}
