const base = process.env.OPS_SMOKE_BASE_URL || "http://localhost:8787";
const adminEmail = process.env.OPS_SMOKE_ADMIN_EMAIL || "boss@ares.test";
const adminPassword = process.env.OPS_SMOKE_ADMIN_PASSWORD || "ares123";
const resetEmail = process.env.OPS_SMOKE_RESET_EMAIL || "supplier@a.test";
const resetPassword = `Reset-${Date.now().toString(36)}-pass1`;

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
    if (!response.ok) throw new Error(`${label} ${path} ${response.status}: ${body?.error || text}`);
    return body;
  };
}

function mustFind(value, message) {
  if (!value) throw new Error(message);
  return value;
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

const admin = makeClient("admin");
const reset = makeClient("reset");

await admin("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: adminEmail, password: adminPassword })
});

let overview = await admin("/api/admin/overview");
if (!overview.counts.users) throw new Error("admin overview did not return users");
if (!overview.ai?.attachmentMaxBytes) throw new Error("admin overview did not return AI readiness policy");

const state = await admin("/api/state");
const activeAgent = mustFind(state.agents[0], "admin smoke requires at least one agent");
const activeContact = mustFind(activeAgent.contacts[0], "admin smoke requires at least one contact");
const aiCallsBefore = overview.counts.aiCalls24h || 0;
const uploadsBefore = overview.counts.fileUploads24h || 0;

await admin(`/api/conversations/${activeContact.conversationId}/instructions`, {
  method: "POST",
  body: JSON.stringify({ agentId: activeAgent.id, text: "烟测：请基于上下文生成一条待审批草稿。" })
});

await admin(`/api/conversations/${activeContact.conversationId}/attachments`, {
  method: "POST",
  body: JSON.stringify({
    agentId: activeAgent.id,
    kind: "图片",
    filename: "smoke-context.png",
    mimeType: "image/png",
    sizeBytes: 2048
  })
});

await expectStatus(
  () => admin(`/api/conversations/${activeContact.conversationId}/attachments`, {
    method: "POST",
    body: JSON.stringify({
      agentId: activeAgent.id,
      kind: "文件",
      filename: "smoke-too-large.pdf",
      mimeType: "application/pdf",
      sizeBytes: overview.ai.attachmentMaxBytes + 1
    })
  }),
  413,
  "oversize context upload was accepted"
);

await expectStatus(
  () => admin(`/api/conversations/${activeContact.conversationId}/attachments`, {
    method: "POST",
    body: JSON.stringify({
      agentId: activeAgent.id,
      kind: "文件",
      filename: "smoke-script.js",
      mimeType: "application/javascript",
      sizeBytes: 128
    })
  }),
  415,
  "unsupported context upload type was accepted"
);

overview = await admin("/api/admin/overview");
if ((overview.counts.aiCalls24h || 0) <= aiCallsBefore) throw new Error("AI usage count did not increase");
if ((overview.counts.fileUploads24h || 0) <= uploadsBefore) throw new Error("file upload count did not increase");
if (!overview.ai.recentEvents.some((event) => ["instruction_draft", "internal_instruction"].includes(event.action))) throw new Error("AI usage event is missing");
if (!overview.ai.recentUploads.some((upload) => upload.filename === "smoke-context.png")) throw new Error("file upload event is missing");

const supplierUser = mustFind(
  overview.users.find((user) => user.email === resetEmail),
  "reset target user is missing"
);

overview = await admin(`/api/admin/users/${supplierUser.id}`, {
  method: "PATCH",
  body: JSON.stringify({ role: "member" })
});
overview = await admin(`/api/admin/users/${supplierUser.id}`, {
  method: "PATCH",
  body: JSON.stringify({ role: "owner" })
});

const supplierOrg = mustFind(
  overview.organizations.find((org) => org.id === supplierUser.organizationId),
  "supplier organization is missing"
);
overview = await admin(`/api/admin/organizations/${supplierOrg.id}`, {
  method: "PATCH",
  body: JSON.stringify({ name: supplierOrg.name })
});

const inviteResult = await admin("/api/registration-invites", {
  method: "POST",
  body: JSON.stringify({
    label: "烟测合作方邀请",
    email: `invite-${Date.now().toString(36)}@example.com`,
    maxUses: 10,
    expiresInDays: 7
  })
});
if (!inviteResult.inviteCode) throw new Error("admin invite code was not returned");
if (inviteResult.invite.maxUses !== 1) throw new Error("invite was not forced to single use");
overview = inviteResult.state.admin ? await admin("/api/admin/overview") : overview;

const cleanupPreview = await admin("/api/admin/cleanup-test-data", {
  method: "POST",
  body: JSON.stringify({ dryRun: true })
});
if (cleanupPreview.result.users < 1) throw new Error("cleanup dry run did not find test users");
if (cleanupPreview.result.invites < 1) throw new Error("cleanup dry run did not find test invites");

const backupResult = await admin("/api/admin/backups", { method: "POST" });
const backup = mustFind(backupResult.backup, "manual backup was not created");
const backupList = await admin("/api/admin/backups");
if (!backupList.backups.some((item) => item.name === backup.name)) throw new Error("backup list does not contain the manual backup");

const restoreResult = await admin(`/api/admin/backups/${encodeURIComponent(backup.name)}/restore`, { method: "POST" });
if (restoreResult.restored !== backup.name) throw new Error("backup restore did not report the requested backup");

const codeResult = await reset("/api/auth/password-reset-code", {
  method: "POST",
  body: JSON.stringify({ email: resetEmail })
});
if (!codeResult.devCode) throw new Error("local password reset smoke requires devCode");

await reset("/api/auth/reset-password", {
  method: "POST",
  body: JSON.stringify({ email: resetEmail, emailCode: codeResult.devCode, password: resetPassword })
});
await reset("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: resetEmail, password: resetPassword })
});

await expectStatus(
  () => reset("/api/registration-invites", {
    method: "POST",
    body: JSON.stringify({ label: "普通负责人不应生成邀请码", email: "blocked@example.com" })
  }),
  403,
  "non-admin user could create registration invite"
);

const cleanupResult = await admin("/api/admin/cleanup-test-data", {
  method: "POST",
  body: JSON.stringify({})
});
if (!cleanupResult.backup?.name) throw new Error("cleanup did not create a safety backup");
if (cleanupResult.result.users < cleanupPreview.result.users) throw new Error("cleanup removed fewer users than the dry run");
if (cleanupResult.overview.users.some((user) => user.email.endsWith(".test"))) {
  throw new Error("cleanup left test users behind");
}

console.log(JSON.stringify({
  ok: true,
  admin: adminEmail,
  managedUsers: overview.counts.users,
  cleanupPreview: cleanupPreview.result,
  cleanupResult: cleanupResult.result,
  backup: backup.name,
  cleanupBackup: cleanupResult.backup.name,
  resetEmail
}, null, 2));
