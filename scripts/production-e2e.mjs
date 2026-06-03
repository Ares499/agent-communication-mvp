const base = (process.env.E2E_BASE_URL || "https://example.com").replace(/\/+$/, "");
const bossEmail = process.env.E2E_BOSS_EMAIL;
const bossPassword = process.env.E2E_BOSS_PASSWORD;
const supplierEmail = process.env.E2E_SUPPLIER_EMAIL;
const supplierPassword = process.env.E2E_SUPPLIER_PASSWORD || `Supplier-${Date.now().toString(36)}-pass1`;
const emailCode = process.env.E2E_EMAIL_CODE;
const inviteCodeFromEnv = process.env.E2E_INVITE_CODE;

if (!bossEmail || !bossPassword || !supplierEmail) {
  throw new Error("Missing E2E_BOSS_EMAIL, E2E_BOSS_PASSWORD, or E2E_SUPPLIER_EMAIL");
}

function makeClient(label) {
  let cookie = "";
  return async function request(path, options = {}) {
    const response = await fetch(base + path, {
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
    if (!response.ok) {
      throw new Error(`${label} ${path} ${response.status}: ${body?.error || text}`);
    }
    return body;
  };
}

function mustFind(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function suffix() {
  return Date.now().toString(36).slice(-8);
}

const boss = makeClient("boss");
const supplier = makeClient("supplier");

const health = await boss("/api/health");
const config = await boss("/api/config");
if (!health.ok) throw new Error("health check failed");
if (!config.registrationInviteRequired) throw new Error("production invite gate is not enabled");
if (!config.emailVerificationRequired) throw new Error("email verification is not enabled");
if (!config.emailSenderConfigured) throw new Error("SMTP sender is not configured");

await boss("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: bossEmail, password: bossPassword })
});

let bossState = await boss("/api/state");
let bossAgent = bossState.agents[0];
if (!bossAgent) {
  bossState = await boss("/api/agents", {
    method: "POST",
    body: JSON.stringify({
      name: "采购智能员工",
      type: "采购智能员工",
      accountId: `boss-buy-${suffix()}`,
      short: "采"
    })
  });
  bossAgent = mustFind(bossState.agents[0], "boss agent was not created");
}

let inviteCode = inviteCodeFromEnv;
if (!inviteCode) {
  const inviteResult = await boss("/api/registration-invites", {
    method: "POST",
    body: JSON.stringify({
      label: `端到端验收 ${supplierEmail}`,
      email: supplierEmail,
      expiresInDays: 7
    })
  });
  inviteCode = inviteResult.inviteCode;
}

if (!emailCode) {
  await supplier("/api/auth/email-code", {
    method: "POST",
    body: JSON.stringify({ email: supplierEmail, invitationCode: inviteCode })
  });
  console.log(JSON.stringify({
    ok: true,
    phase: "email-code-sent",
    base,
    supplierEmail,
    inviteCode,
    next: "Read the mailbox verification code, then rerun with E2E_INVITE_CODE and E2E_EMAIL_CODE."
  }, null, 2));
  process.exit(0);
}

await supplier("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({
    invitationCode: inviteCode,
    orgName: `供应商验收 ${suffix()}`,
    name: "供应商负责人",
    email: supplierEmail,
    emailCode,
    password: supplierPassword
  })
});

let supplierState = await supplier("/api/state");
supplierState = await supplier("/api/agents", {
  method: "POST",
  body: JSON.stringify({
    name: "供应商验收智能员工",
    type: "销售智能员工",
    accountId: `supplier-sales-${suffix()}`,
    short: "供"
  })
});
const supplierAgent = mustFind(supplierState.agents[0], "supplier agent was not created");

bossState = await boss("/api/agents/" + bossAgent.id + "/contacts", {
  method: "POST",
  body: JSON.stringify({ accountId: supplierAgent.accountId })
});
if (!bossState.outgoingRequests.length) throw new Error("boss outgoing connection request was not created");

supplierState = await supplier("/api/state");
const incoming = mustFind(supplierState.incomingRequests[0], "supplier did not receive connection request");
supplierState = await supplier(`/api/connection-requests/${incoming.id}/resolve`, {
  method: "POST",
  body: JSON.stringify({ action: "accept" })
});

bossState = await boss("/api/state");
bossAgent = mustFind(bossState.agents.find((agent) => agent.id === bossAgent.id), "boss agent missing after accept");
const bossContact = mustFind(
  bossAgent.contacts.find((contact) => contact.accountId === supplierAgent.accountId),
  "boss contact was not created"
);

bossState = await boss(`/api/conversations/${bossContact.conversationId}/instructions`, {
  method: "POST",
  body: JSON.stringify({
    agentId: bossAgent.id,
    text: "请确认 50 件以内是否可以先保留库存，语气客气一点。"
  })
});
bossAgent = mustFind(bossState.agents.find((agent) => agent.id === bossAgent.id), "boss agent missing after instruction");
const contactAfterInstruction = mustFind(
  bossAgent.contacts.find((contact) => contact.conversationId === bossContact.conversationId),
  "conversation missing after instruction"
);
const approval = mustFind(contactAfterInstruction.approvals[0], "approval was not generated from instruction");

bossState = await boss(`/api/approvals/${approval.id}/resolve`, {
  method: "POST",
  body: JSON.stringify({ action: "approve" })
});
bossAgent = mustFind(bossState.agents.find((agent) => agent.id === bossAgent.id), "boss agent missing after approval");
const finalContact = mustFind(
  bossAgent.contacts.find((contact) => contact.conversationId === bossContact.conversationId),
  "conversation missing after approval"
);

if (!finalContact.messages.some((message) => message.kind === "out" && message.text.includes("50"))) {
  throw new Error("approved agent message was not sent into the conversation");
}
if (!finalContact.logs.some((log) => log.title.includes("批准"))) {
  throw new Error("approval operation log was not recorded");
}

console.log(JSON.stringify({
  ok: true,
  phase: "full-chain-passed",
  base,
  boss: bossEmail,
  supplier: supplierEmail,
  supplierAgentId: supplierAgent.accountId,
  conversationId: bossContact.conversationId,
  messageCount: finalContact.messages.length,
  logCount: finalContact.logs.length
}, null, 2));
