async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "请求失败");
  }
  return response.json();
}

export const api = {
  config: () => request("/api/config"),
  demoAccounts: () => request("/api/demo-accounts"),
  login: (payload) => request("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  sendEmailCode: (payload) => request("/api/auth/email-code", { method: "POST", body: JSON.stringify(payload) }),
  sendPasswordResetCode: (payload) => request("/api/auth/password-reset-code", { method: "POST", body: JSON.stringify(payload) }),
  resetPassword: (payload) => request("/api/auth/reset-password", { method: "POST", body: JSON.stringify(payload) }),
  register: (payload) => request("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  state: () => request("/api/state"),
  setActive: (agentId, contactAgentId) =>
    request("/api/state/active", { method: "POST", body: JSON.stringify({ agentId, contactAgentId }) }),
  createRegistrationInvite: (payload) =>
    request("/api/registration-invites", { method: "POST", body: JSON.stringify(payload) }),
  reset: () => request("/api/demo/reset", { method: "POST" }),
  createAgent: (payload) => request("/api/agents", { method: "POST", body: JSON.stringify(payload) }),
  lookupAgent: (accountId) => request(`/api/directory/${encodeURIComponent(accountId)}`),
  addContact: (agentId, accountId) =>
    request(`/api/agents/${agentId}/contacts`, { method: "POST", body: JSON.stringify({ accountId }) }),
  resolveConnectionRequest: (requestId, action) =>
    request(`/api/connection-requests/${requestId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action })
    }),
  sendInstruction: (agentId, conversationId, text) =>
    request(`/api/conversations/${conversationId}/instructions`, {
      method: "POST",
      body: JSON.stringify({ agentId, text })
    }),
  receivePeerMessage: (agentId, conversationId, text) =>
    request(`/api/conversations/${conversationId}/peer-messages`, {
      method: "POST",
      body: JSON.stringify({ agentId, text })
    }),
  setConversationMode: (agentId, conversationId, mode) =>
    request(`/api/conversations/${conversationId}/mode`, {
      method: "PATCH",
      body: JSON.stringify({ agentId, mode })
    }),
  attachContext: (agentId, conversationId, metadata) =>
    request(`/api/conversations/${conversationId}/attachments`, {
      method: "POST",
      body: JSON.stringify({ agentId, ...metadata })
    }),
  resolveApproval: (approvalId, action, payload = {}) =>
    request(`/api/approvals/${approvalId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action, ...payload })
    }),
  resolveBoardItem: (boardItemId) => request(`/api/board-items/${boardItemId}/resolve`, { method: "POST" }),
  adminOverview: () => request("/api/admin/overview"),
  adminUpdateUser: (userId, payload) =>
    request(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  adminUpdateOrganization: (orgId, payload) =>
    request(`/api/admin/organizations/${orgId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  adminCleanupTestData: (payload = {}) =>
    request("/api/admin/cleanup-test-data", { method: "POST", body: JSON.stringify(payload) }),
  adminBackups: () => request("/api/admin/backups"),
  adminCreateBackup: () => request("/api/admin/backups", { method: "POST" }),
  adminRestoreBackup: (backupName) =>
    request(`/api/admin/backups/${encodeURIComponent(backupName)}/restore`, { method: "POST" })
};
