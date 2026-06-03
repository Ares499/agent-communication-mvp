const base = process.env.SMOKE_BASE_URL || "http://localhost:8787";
let cookie = "";

async function request(path, { token, ...options } = {}) {
  const response = await fetch(base + path, {
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...options
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const health = await request("/api/health");
const config = await request("/api/config");
let login;

if (config.allowDemo) {
  login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "boss@ares.test", password: "ares123" })
  });
} else {
  const suffix = Date.now().toString(36);
  login = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      orgName: `烟测组织 ${suffix}`,
      name: "烟测负责人",
      email: `smoke-${suffix}@example.com`,
      password: "smoke-test-123"
    })
  });
await request("/api/agents", {
    method: "POST",
    body: JSON.stringify({
      name: "烟测采购智能员工",
      type: "采购智能员工",
      accountId: `smoke-buy-${suffix}`,
      short: "测"
    })
  });
}

const state = await request("/api/state", { token: login.token });

if (!health.ok) throw new Error("health check failed");
if (!state.agents.length) throw new Error("expected at least one agent");

console.log(JSON.stringify({
  ok: true,
  health: health.counts,
  allowDemo: config.allowDemo,
  user: state.user.email,
  org: state.org.name,
  agents: state.agents.length
}, null, 2));
