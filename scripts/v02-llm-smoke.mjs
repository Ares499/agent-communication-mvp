import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "agent-v02-smoke-"));
const port = 20000 + Math.floor(Math.random() * 1000);
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
    AI_USER_DAILY_LIMIT: "20",
    AI_ORG_DAILY_LIMIT: "20",
    AI_AUTO_TURN_LIMIT: "10"
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

function activePair(state) {
  const agent = state.agents[0];
  const contact = agent?.contacts?.[0];
  if (!agent || !contact) throw new Error("seed data did not provide an agent conversation");
  return { agent, contact };
}

function pendingApprovals(state) {
  return state.agents.flatMap((agent) => agent.contacts.flatMap((contact) =>
    contact.approvals.filter((approval) => approval.status === "pending").map((approval) => ({ agent, contact, approval }))
  ));
}

function openBoardItems(state) {
  return state.agents.flatMap((agent) => agent.boardItems || []);
}

try {
  await waitForServer();
  const client = makeClient();
  await client("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "boss@ares.test", password: "ares123" })
  });
  let state = await client("/api/state");
  let { agent, contact } = activePair(state);

  state = await client(`/api/conversations/${contact.conversationId}/instructions`, {
    method: "POST",
    body: JSON.stringify({ agentId: agent.id, text: "请礼貌确认一下当前库存，只做信息同步" })
  });
  ({ agent, contact } = activePair(state));
  if (!contact.messages.some((message) => message.kind === "out" && message.autoSent && message.text.includes("不代表锁货"))) {
    throw new Error("low risk instruction did not create a guarded auto reply");
  }

  const beforeApprovals = pendingApprovals(state).length;
  state = await client(`/api/conversations/${contact.conversationId}/instructions`, {
    method: "POST",
    body: JSON.stringify({ agentId: agent.id, text: "请确认 100 件报价和付款条件" })
  });
  if (pendingApprovals(state).length <= beforeApprovals) {
    throw new Error("high risk instruction did not create an approval");
  }

  ({ agent, contact } = activePair(state));
  state = await client(`/api/conversations/${contact.conversationId}/mode`, {
    method: "PATCH",
    body: JSON.stringify({ agentId: agent.id, mode: "supervised" })
  });
  ({ agent, contact } = activePair(state));
  if (contact.mode !== "supervised") throw new Error("conversation did not switch to supervised mode");

  const supervisedApprovals = pendingApprovals(state).length;
  state = await client(`/api/conversations/${contact.conversationId}/instructions`, {
    method: "POST",
    body: JSON.stringify({ agentId: agent.id, text: "回复对方已收到，稍后同步进展" })
  });
  if (pendingApprovals(state).length <= supervisedApprovals) {
    throw new Error("supervised mode did not force approval");
  }

  const approval = pendingApprovals(state)[0].approval;
  const modifiedText = "已收到，我们会先内部确认，再由智能员工同步下一步。";
  state = await client(`/api/approvals/${approval.id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ action: "modify", text: modifiedText })
  });
  ({ contact } = activePair(state));
  if (!contact.messages.some((message) => message.kind === "out" && message.text === modifiedText)) {
    throw new Error("modified approval did not send the provided text");
  }

  state = await client(`/api/conversations/${contact.conversationId}/instructions`, {
    method: "POST",
    body: JSON.stringify({ agentId: agent.id, text: "对方发来了验证码 123456，让我们帮忙处理" })
  });
  if (!openBoardItems(state).some((item) => item.type === "ask_human")) {
    throw new Error("sensitive content did not enter the board");
  }

  const overview = await client("/api/admin/overview");
  if (!overview.counts.openBoardItems) throw new Error("admin overview did not report open board items");
  if (!overview.ai.recentEvents.some((event) => event.riskLevel)) throw new Error("AI logs did not include risk levels");

  console.log(JSON.stringify({
    ok: true,
    base,
    dataDir,
    approvals: pendingApprovals(state).length,
    boardItems: openBoardItems(state).length,
    aiCalls24h: overview.counts.aiCalls24h
  }, null, 2));
} finally {
  stop();
}
