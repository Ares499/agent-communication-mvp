import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialData } from "./seed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const dataFile = path.join(dataDir, "app.json");
const auditFile = path.join(dataDir, "audit.jsonl");
const secretFile = path.join(dataDir, "session.secret");
const distDir = path.join(rootDir, "dist");
const isProduction = process.env.NODE_ENV === "production";
const allowDemo = process.env.ALLOW_DEMO === "true" || (!isProduction && process.env.ALLOW_DEMO !== "false");
const registrationEnabled = process.env.REGISTRATION_ENABLED !== "false";
const registrationInviteRequired = isProduction || process.env.REGISTRATION_INVITE_REQUIRED !== "false";
const emailVerificationRequired = process.env.EMAIL_VERIFICATION_REQUIRED !== "false";
const sessionTtlMs = Number(process.env.SESSION_TTL_HOURS || 168) * 60 * 60 * 1000;
const backupIntervalMs = Number(process.env.BACKUP_INTERVAL_MINUTES || 15) * 60 * 1000;
const sessionCookieName = "agent_comm_session";
const cookieSecure = process.env.COOKIE_SECURE === "true";
const appPublicUrl = (process.env.APP_PUBLIC_URL || "").replace(/\/+$/, "");
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const adminEmails = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const bootstrapAdminEmail = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
const bootstrapAdminPassword = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "");
const bootstrapAdminName = String(process.env.BOOTSTRAP_ADMIN_NAME || "平台管理员").trim();
const bootstrapAdminOrgName = String(process.env.BOOTSTRAP_ADMIN_ORG || "平台运营").trim();
const bootstrapAdminResetPassword = process.env.BOOTSTRAP_ADMIN_RESET_PASSWORD === "true";
const dataVersion = 8;
const aiProvider = String(process.env.AI_PROVIDER || "disabled").trim() || "disabled";
const aiTextModel = String(process.env.AI_TEXT_MODEL || "agent-draft-simulator-v0").trim() || "agent-draft-simulator-v0";
const aiApiKeyConfigured = Boolean(process.env.AI_API_KEY);
const aiBaseUrl = String(process.env.AI_BASE_URL || "https://api.openai.com/v1/chat/completions").trim();
const aiRequestTimeoutMs = Math.max(1000, numberEnv(process.env.AI_REQUEST_TIMEOUT_MS, 20_000));
const aiMaxRetries = Math.min(Math.max(0, numberEnv(process.env.AI_MAX_RETRIES, 1)), 3);
const aiOrgDailyLimit = Math.max(0, numberEnv(process.env.AI_ORG_DAILY_LIMIT, 100));
const aiUserDailyLimit = Math.max(0, numberEnv(process.env.AI_USER_DAILY_LIMIT, 30));
const maxAutoTurnsPerConversationWindow = Math.max(1, numberEnv(process.env.AI_AUTO_TURN_LIMIT, 4));
const defaultAttachmentTypes = "image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv";
const attachmentAllowedTypes = (process.env.ATTACHMENT_ALLOWED_TYPES || defaultAttachmentTypes)
  .split(",")
  .map((type) => type.trim().toLowerCase())
  .filter(Boolean);
const attachmentAllowedTypeSet = new Set(attachmentAllowedTypes);
const attachmentMaxBytes = Math.max(1, numberEnv(process.env.ATTACHMENT_MAX_BYTES, 5 * 1024 * 1024));
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const sessionSecret = loadOrCreateSessionSecret();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(securityHeaders);
app.use(cors({
  origin(origin, callback) {
    if (!origin || !isProduction || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin is not allowed"));
  }
}));
app.use(express.json({ limit: "2mb" }));
app.use("/api/auth", rateLimit({ windowMs: 60_000, max: 20 }));
app.use("/api", rateLimit({ windowMs: 60_000, max: 240 }));

let writeChain = Promise.resolve();
let lastBackupAt = 0;
let mailer;

function loadOrCreateSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(secretFile)) return readFileSync(secretFile, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("hex");
  writeFileSync(secretFile, secret, { mode: 0o600 });
  try {
    chmodSync(secretFile, 0o600);
  } catch {
    // Best effort on filesystems that do not support chmod.
  }
  return secret;
}

function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  next();
}

function rateLimit({ windowMs, max }) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const current = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || current > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: current + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) return res.status(429).json({ error: "请求太频繁，请稍后再试" });
    return next();
  };
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function numberEnv(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function now() {
  return new Date().toISOString();
}

function displayTime(value) {
  const date = new Date(value || Date.now());
  const today = new Date();
  if (date.toDateString() !== today.toDateString()) return `${date.getMonth() + 1}/${date.getDate()}`;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  const [, salt, expected] = stored.split("$");
  const actual = hashPassword(password, salt).split("$")[2];
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function hashToken(token) {
  return crypto.createHmac("sha256", sessionSecret).update(token).digest("hex");
}

function hashSecret(value, scope = "generic") {
  return crypto.createHmac("sha256", sessionSecret).update(`${scope}:${String(value)}`).digest("hex");
}

function getMailer() {
  if (!smtpConfigured) return null;
  if (!mailer) {
    mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: process.env.SMTP_SECURE !== "false",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return mailer;
}

async function sendVerificationEmail(email, code, purpose = "registration") {
  const transport = getMailer();
  if (!transport) {
    if (isProduction) throw Object.assign(new Error("邮件服务还没有配置，暂时不能发送验证码"), { status: 503, expose: true });
    return false;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const isReset = purpose === "password-reset";
  await transport.sendMail({
    from,
    to: email,
    subject: isReset ? "智能员工通信重置密码验证码" : "智能员工通信注册验证码",
    text: `你的${isReset ? "重置密码" : "注册"}验证码是 ${code}，10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。`,
    html: `<p>你的${isReset ? "重置密码" : "注册"}验证码是 <b>${code}</b>，10 分钟内有效。</p><p>如果不是你本人操作，可以忽略这封邮件。</p>`
  });
  return true;
}

function parseCookies(header = "") {
  return Object.fromEntries(header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      const key = separator >= 0 ? part.slice(0, separator) : part;
      const value = separator >= 0 ? part.slice(separator + 1) : "";
      return [decodeURIComponent(key), decodeURIComponent(value)];
    }));
}

function requestToken(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (bearer) return bearer;
  return parseCookies(req.headers.cookie)[sessionCookieName];
}

function setSessionCookie(res, token) {
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    maxAge: sessionTtlMs,
    path: "/"
  });
}

function clearSessionCookie(res) {
  res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: "lax", secure: cookieSecure, path: "/" });
}

function normalizeData(data) {
  const next = data && typeof data === "object" ? data : {};
  next.version = dataVersion;
  next.organizations ||= [];
  next.users ||= [];
  next.sessions ||= [];
  next.agents ||= [];
  next.contacts ||= [];
  next.connectionRequests ||= [];
  next.conversations ||= [];
  next.messages ||= [];
  next.approvals ||= [];
  next.instructions ||= [];
  next.logs ||= [];
  next.boardItems ||= [];
  next.emailVerifications ||= [];
  next.registrationInvites ||= [];
  next.riskEvents ||= [];
  next.aiUsageEvents ||= [];
  next.fileUploads ||= [];
  next.organizations.forEach((org) => {
    org.status ||= "active";
    org.createdAt ||= next.createdAt || now();
  });
  next.users.forEach((user) => {
    user.status ||= "active";
    user.role ||= "owner";
    user.createdAt ||= next.createdAt || now();
  });
  next.registrationInvites.forEach((invite) => {
    invite.status ||= invite.revokedAt ? "revoked" : "active";
  });
  next.conversations.forEach((conversation) => {
    conversation.mode ||= "auto";
  });
  next.contacts.forEach((contact) => {
    contact.mode ||= "auto";
    contact.autoTurnCount ||= 0;
  });
  next.approvals.forEach((approval) => {
    approval.riskLevel ||= riskLevelFromLabel(approval.risk);
    approval.riskReasons ||= approval.risk ? [approval.risk] : [];
    approval.missingInfo ||= [];
    approval.ruleOverrides ||= [];
    approval.modelAction ||= "";
    approval.draftSource ||= "legacy";
  });
  return next;
}

function ensureBootstrapAdmin(data) {
  if (!bootstrapAdminEmail || !bootstrapAdminPassword) return false;
  if (!emailIsValid(bootstrapAdminEmail)) throw new Error("BOOTSTRAP_ADMIN_EMAIL 格式不正确");
  const password = assertPassword(bootstrapAdminPassword);
  let user = data.users.find((item) => item.email.toLowerCase() === bootstrapAdminEmail);
  if (!user) {
    let organization = data.organizations.find((org) => org.name === bootstrapAdminOrgName);
    if (!organization) {
      organization = { id: id("org"), name: bootstrapAdminOrgName, status: "active", createdAt: now() };
      data.organizations.push(organization);
    } else {
      organization.status = "active";
    }
    user = {
      id: id("user"),
      organizationId: organization.id,
      name: bootstrapAdminName || "平台管理员",
      email: bootstrapAdminEmail,
      passwordHash: hashPassword(password),
      role: "platform_admin",
      status: "active",
      activeAgentId: "",
      activeContactAgentId: "",
      createdAt: now()
    };
    data.users.push(user);
    return true;
  }
  let changed = false;
  if (user.role !== "platform_admin") {
    user.role = "platform_admin";
    changed = true;
  }
  if ((user.status || "active") !== "active") {
    user.status = "active";
    changed = true;
  }
  if (bootstrapAdminResetPassword) {
    user.passwordHash = hashPassword(password);
    user.passwordChangedAt = now();
    data.sessions = data.sessions.filter((session) => session.userId !== user.id);
    changed = true;
  }
  return changed;
}

function ensureConfiguredPlatformAdmins(data) {
  if (!adminEmails.length) return false;
  let changed = false;
  for (const user of data.users) {
    if (!adminEmails.includes(String(user.email || "").toLowerCase())) continue;
    if (user.role !== "platform_admin") {
      user.role = "platform_admin";
      changed = true;
    }
    if ((user.status || "active") !== "active") {
      user.status = "active";
      changed = true;
    }
  }
  return changed;
}

async function saveData(data) {
  await mkdir(dataDir, { recursive: true });
  data.version = dataVersion;
  data.updatedAt = now();
  const payload = JSON.stringify(data, null, 2);
  writeChain = writeChain.catch(() => {}).then(async () => {
    await backupDataIfNeeded();
    const tmpFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpFile, payload, "utf8");
    await rename(tmpFile, dataFile);
  });
  return writeChain;
}

async function backupDataIfNeeded() {
  if (!existsSync(dataFile)) return;
  const current = Date.now();
  if (current - lastBackupAt < backupIntervalMs) return;
  lastBackupAt = current;
  const backupDir = backupDirectory();
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(dataFile, path.join(backupDir, `app-${stamp}.json`));
}

async function ensureData() {
  await mkdir(dataDir, { recursive: true });
  try {
    const data = normalizeData(JSON.parse(await readFile(dataFile, "utf8")));
    const bootstrapped = ensureBootstrapAdmin(data);
    const configuredAdmins = ensureConfiguredPlatformAdmins(data);
    if (!data.updatedAt || data.version !== dataVersion || bootstrapped || configuredAdmins) await saveData(data);
    return;
  } catch {
    // Create seed data below.
  }
  const data = normalizeData(createInitialData(hashPassword));
  ensureBootstrapAdmin(data);
  ensureConfiguredPlatformAdmins(data);
  await saveData(data);
}

async function loadData() {
  await ensureData();
  return normalizeData(JSON.parse(await readFile(dataFile, "utf8")));
}

async function audit(event, details = {}) {
  const entry = { time: now(), event, ...details };
  await mkdir(dataDir, { recursive: true });
  await appendFile(auditFile, `${JSON.stringify(entry)}\n`, "utf8").catch(() => {});
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status || "active", organizationId: user.organizationId };
}

function publicOrg(org) {
  return { id: org.id, name: org.name, status: org.status || "active" };
}

function isPlatformAdmin(user) {
  return user?.role === "platform_admin" || adminEmails.includes(String(user?.email || "").toLowerCase());
}

function assertPlatformAdmin(req, res) {
  if (isPlatformAdmin(req.user)) return true;
  res.status(403).json({ error: "需要平台管理员权限" });
  return false;
}

function assertStatus(value, field) {
  const status = String(value || "").trim();
  if (!["active", "suspended"].includes(status)) {
    throw Object.assign(new Error(`${field}状态不正确`), { status: 400 });
  }
  return status;
}

function publicAdminUser(data, user) {
  const org = data.organizations.find((item) => item.id === user.organizationId);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status || "active",
    organizationId: user.organizationId,
    organizationName: org?.name || "未知组织",
    createdAt: user.createdAt || ""
  };
}

function publicAdminOrg(data, org) {
  return {
    id: org.id,
    name: org.name,
    status: org.status || "active",
    createdAt: org.createdAt || "",
    userCount: data.users.filter((user) => user.organizationId === org.id).length,
    agentCount: data.agents.filter((agentItem) => agentItem.organizationId === org.id).length,
    activeSessionCount: data.sessions.filter((session) => {
      const user = data.users.find((item) => item.id === session.userId);
      return user?.organizationId === org.id && (!session.expiresAt || new Date(session.expiresAt) > new Date());
    }).length
  };
}

function getSession(data, token) {
  const tokenHash = hashToken(token);
  const session = data.sessions.find((item) => item.tokenHash === tokenHash);
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt) <= new Date()) return null;
  const user = data.users.find((item) => item.id === session.userId);
  if (!user) return null;
  const org = data.organizations.find((item) => item.id === user.organizationId);
  if (!org) return null;
  return { session, user, org };
}

async function auth(req, res, next) {
  const token = requestToken(req);
  if (!token) return res.status(401).json({ error: "请先登录" });
  const data = await loadData();
  const before = data.sessions.length;
  data.sessions = data.sessions.filter((item) => !item.expiresAt || new Date(item.expiresAt) > new Date());
  if (data.sessions.length !== before) await saveData(data);
  const found = getSession(data, token);
  if (!found) return res.status(401).json({ error: "登录已失效" });
  if ((found.user.status || "active") !== "active" || (found.org.status || "active") !== "active") {
    return res.status(403).json({ error: "账号或组织已被停用" });
  }
  req.data = data;
  req.session = found.session;
  req.user = found.user;
  req.org = found.org;
  next();
}

function emailIsValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function assertText(value, field, { min = 1, max = 120, pattern } = {}) {
  const text = String(value || "").trim();
  if (text.length < min) throw Object.assign(new Error(`${field}不能为空`), { status: 400 });
  if (text.length > max) throw Object.assign(new Error(`${field}太长了`), { status: 400 });
  if (pattern && !pattern.test(text)) throw Object.assign(new Error(`${field}格式不正确`), { status: 400 });
  return text;
}

function assertPassword(password) {
  const text = String(password || "");
  if (text.length < 8) throw Object.assign(new Error("密码至少需要 8 位"), { status: 400 });
  if (text.length > 128) throw Object.assign(new Error("密码太长了"), { status: 400 });
  return text;
}

function assertInviteCode(value) {
  return assertText(String(value || "").trim().toUpperCase(), "邀请码", { min: 8, max: 32, pattern: /^[A-Z0-9-]+$/ });
}

function featureFlags() {
  return {
    allowDemo,
    registrationEnabled,
    registrationInviteRequired,
    emailVerificationRequired,
    emailSenderConfigured: smtpConfigured
  };
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function aiRuntimeStatus() {
  if (aiProvider === "disabled") return "simulated";
  return aiApiKeyConfigured ? "ready" : "missing_api_key";
}

function countAiCallsToday(data, predicate) {
  const cutoff = startOfToday();
  return (data.aiUsageEvents || []).filter((event) =>
    event.status !== "blocked_quota" &&
    new Date(event.createdAt).getTime() >= cutoff &&
    predicate(event)
  ).length;
}

function aiUsageFor(data, user, org) {
  const orgCallsToday = countAiCallsToday(data, (event) => event.organizationId === org.id);
  const userCallsToday = countAiCallsToday(data, (event) => event.userId === user.id);
  return {
    runtimeStatus: aiRuntimeStatus(),
    provider: aiProvider,
    model: aiTextModel,
    apiKeyConfigured: aiApiKeyConfigured,
    organization: {
      limit: aiOrgDailyLimit,
      used: orgCallsToday,
      remaining: Math.max(0, aiOrgDailyLimit - orgCallsToday)
    },
    user: {
      limit: aiUserDailyLimit,
      used: userCallsToday,
      remaining: Math.max(0, aiUserDailyLimit - userCallsToday)
    }
  };
}

function estimatedTokens(inputChars, outputChars = 0) {
  return Math.max(1, Math.ceil((inputChars + outputChars) / 4));
}

function riskLabel(level) {
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  return "低风险";
}

function riskLevelFromLabel(label = "") {
  const text = String(label);
  if (text.includes("高")) return "high";
  if (text.includes("中")) return "medium";
  return "low";
}

function recordAiUsage(data, details) {
  data.aiUsageEvents ||= [];
  const event = {
    id: id("ai"),
    organizationId: details.organizationId,
    userId: details.userId,
    agentId: details.agentId,
    conversationId: details.conversationId,
    action: details.action,
    provider: aiProvider,
    model: aiTextModel,
    runtimeStatus: aiRuntimeStatus(),
    status: details.status,
    reason: details.reason || "",
    riskLevel: details.riskLevel || "",
    riskReasons: details.riskReasons || [],
    ruleOverrides: details.ruleOverrides || [],
    latencyMs: details.latencyMs || 0,
    errorType: details.errorType || "",
    inputChars: details.inputChars || 0,
    outputChars: details.outputChars || 0,
    estimatedTokens: details.estimatedTokens || estimatedTokens(details.inputChars || 0, details.outputChars || 0),
    estimatedCost: details.estimatedCost || 0,
    createdAt: now()
  };
  data.aiUsageEvents.unshift(event);
  data.aiUsageEvents = data.aiUsageEvents.slice(0, 5000);
  return event;
}

function publicAiUsageEvent(data, event) {
  const org = data.organizations.find((item) => item.id === event.organizationId);
  const user = data.users.find((item) => item.id === event.userId);
  const agent = data.agents.find((item) => item.id === event.agentId);
  return {
    id: event.id,
    time: event.createdAt,
    organizationName: org?.name || "未知组织",
    userEmail: user?.email || "",
    agentName: agent?.name || "",
    action: event.action,
    status: event.status,
    runtimeStatus: event.runtimeStatus,
    provider: event.provider,
    model: event.model,
    estimatedTokens: event.estimatedTokens,
    latencyMs: event.latencyMs || 0,
    riskLevel: event.riskLevel || "",
    errorType: event.errorType || "",
    reason: event.reason
  };
}

function assertAiQuota(data, req, ownerAgent, conversationId, inputChars) {
  const usage = aiUsageFor(data, req.user, req.org);
  const quotaExceeded = usage.organization.remaining <= 0 || usage.user.remaining <= 0;
  if (!quotaExceeded) return usage;
  recordAiUsage(data, {
    organizationId: req.org.id,
    userId: req.user.id,
    agentId: ownerAgent.id,
    conversationId,
    action: "instruction_draft",
    status: "blocked_quota",
    reason: usage.organization.remaining <= 0 ? "organization_daily_limit" : "user_daily_limit",
    inputChars,
    outputChars: 0
  });
  throw Object.assign(new Error("今天的 Agent 调用额度已用完，请联系平台管理员调整限额"), { status: 429, expose: true });
}

function assertAttachmentMetadata(body) {
  const kind = assertText(body.kind || "文件", "附件类型", { min: 1, max: 20 });
  const filename = assertText(body.filename || `${kind}上下文`, "文件名", { min: 1, max: 160 });
  const mimeType = String(body.mimeType || "").trim().toLowerCase();
  if (!mimeType) throw Object.assign(new Error("文件类型不能为空"), { status: 400 });
  const sizeBytes = Number(body.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw Object.assign(new Error("文件大小不正确"), { status: 400 });
  if (sizeBytes > attachmentMaxBytes) {
    throw Object.assign(new Error(`文件不能超过 ${formatBytes(attachmentMaxBytes)}`), { status: 413, expose: true });
  }
  if (!attachmentAllowedTypeSet.has(mimeType)) {
    throw Object.assign(new Error("暂不支持这个文件类型"), { status: 415, expose: true });
  }
  return { kind, filename, mimeType, sizeBytes };
}

function cleanupRegistrationSecurity(data) {
  const current = Date.now();
  data.emailVerifications = (data.emailVerifications || []).filter((item) =>
    !item.expiresAt || new Date(item.expiresAt).getTime() > current - 24 * 60 * 60 * 1000
  );
  data.registrationInvites ||= [];
  data.riskEvents = (data.riskEvents || []).filter((item) => current - new Date(item.createdAt).getTime() < 30 * 24 * 60 * 60 * 1000);
}

function recentRiskEvents(data, { kind, emailHash, ipHash, windowMs }) {
  const cutoff = Date.now() - windowMs;
  return (data.riskEvents || []).filter((event) =>
    event.kind === kind &&
    (!emailHash || event.emailHash === emailHash) &&
    (!ipHash || event.ipHash === ipHash) &&
    new Date(event.createdAt).getTime() >= cutoff
  );
}

function addRiskEvent(data, { kind, email, ip, details = {} }) {
  data.riskEvents ||= [];
  data.riskEvents.unshift({
    id: id("risk"),
    kind,
    emailHash: email ? hashSecret(String(email).toLowerCase(), "risk-email") : "",
    ipHash: ip ? hashSecret(ip, "risk-ip") : "",
    details,
    createdAt: now()
  });
  data.riskEvents = data.riskEvents.slice(0, 1000);
}

function assertLoginRiskAllowed(data, email, ip) {
  const emailHash = hashSecret(email, "risk-email");
  const ipHash = hashSecret(ip, "risk-ip");
  const byEmail = recentRiskEvents(data, { kind: "login_failed", emailHash, windowMs: 15 * 60 * 1000 }).length;
  const byIp = recentRiskEvents(data, { kind: "login_failed", ipHash, windowMs: 15 * 60 * 1000 }).length;
  if (byEmail >= 5) throw Object.assign(new Error("这个账号登录失败次数过多，请 15 分钟后再试"), { status: 429 });
  if (byIp >= 30) throw Object.assign(new Error("当前网络登录失败次数过多，请稍后再试"), { status: 429 });
}

function assertVerificationRiskAllowed(data, email, ip, purpose) {
  const emailHash = hashSecret(email, "risk-email");
  const ipHash = hashSecret(ip, "risk-ip");
  const byEmail = recentRiskEvents(data, { kind: `${purpose}_code_sent`, emailHash, windowMs: 24 * 60 * 60 * 1000 }).length;
  const byIp = recentRiskEvents(data, { kind: `${purpose}_code_sent`, ipHash, windowMs: 24 * 60 * 60 * 1000 }).length;
  if (byEmail >= 8) throw Object.assign(new Error("这个邮箱今天获取验证码次数过多"), { status: 429 });
  if (byIp >= 30) throw Object.assign(new Error("当前网络今天获取验证码次数过多"), { status: 429 });
}

async function issueEmailCode(data, { email, ip, purpose, invitationCode }) {
  const current = Date.now();
  const recentForEmail = data.emailVerifications.filter((item) =>
    item.email === email &&
    item.purpose === purpose &&
    current - new Date(item.createdAt).getTime() < 24 * 60 * 60 * 1000
  );
  const lastForEmail = recentForEmail.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (lastForEmail && current - new Date(lastForEmail.createdAt).getTime() < 60_000) {
    throw Object.assign(new Error("验证码刚刚发送过，请 60 秒后再试"), { status: 429 });
  }
  assertVerificationRiskAllowed(data, email, ip, purpose);
  const code = String(crypto.randomInt(100000, 1000000));
  await sendVerificationEmail(email, code, purpose);
  data.emailVerifications.unshift({
    id: id("email-code"),
    email,
    codeHash: hashSecret(`${email}:${code}`, "email-verification"),
    purpose,
    invitationCodeHash: invitationCode ? hashSecret(assertInviteCode(invitationCode), "registration-invite") : "",
    attempts: 0,
    ipHash: hashSecret(ip, "ip"),
    createdAt: now(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  addRiskEvent(data, { kind: `${purpose}_code_sent`, email, ip, details: { delivered: smtpConfigured } });
  return code;
}

function generateInviteCode() {
  const raw = crypto.randomBytes(9).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return `INV-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function findInviteByCode(data, code) {
  if (!code) return null;
  const codeHash = hashSecret(assertInviteCode(code), "registration-invite");
  return (data.registrationInvites || []).find((invite) => invite.codeHash === codeHash);
}

function validateInvite(data, code, email) {
  if (!registrationInviteRequired) return null;
  const invite = findInviteByCode(data, code);
  if (!invite) throw Object.assign(new Error("邀请码不存在或已失效"), { status: 403 });
  if (invite.revokedAt) throw Object.assign(new Error("这个邀请码已经失效"), { status: 403 });
  if (invite.expiresAt && new Date(invite.expiresAt) <= new Date()) throw Object.assign(new Error("这个邀请码已过期"), { status: 403 });
  if ((invite.usedCount || 0) >= (invite.maxUses || 1)) throw Object.assign(new Error("这个邀请码已经被使用"), { status: 403 });
  if (invite.email && email && invite.email.toLowerCase() !== email.toLowerCase()) {
    throw Object.assign(new Error("这个邀请码不属于当前邮箱"), { status: 403 });
  }
  return invite;
}

function publicInvite(invite) {
  return {
    id: invite.id,
    label: invite.label,
    email: invite.email,
    status: invite.status || (invite.revokedAt ? "revoked" : "active"),
    maxUses: invite.maxUses,
    usedCount: invite.usedCount || 0,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
    createdBy: invite.createdBy
  };
}

function verificationCodeIsValid(data, email, code, purpose = "registration") {
  if (!emailVerificationRequired) return true;
  const codeHash = hashSecret(`${email}:${String(code || "").trim()}`, "email-verification");
  const verification = (data.emailVerifications || [])
    .filter((item) => item.email === email && item.purpose === purpose && !item.consumedAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (!verification) throw Object.assign(new Error("请先获取邮箱验证码"), { status: 400 });
  if (new Date(verification.expiresAt) <= new Date()) throw Object.assign(new Error("邮箱验证码已过期，请重新获取"), { status: 400 });
  if ((verification.attempts || 0) >= 5) throw Object.assign(new Error("验证码错误次数过多，请重新获取"), { status: 400 });
  if (verification.codeHash !== codeHash) {
    verification.attempts = (verification.attempts || 0) + 1;
    throw Object.assign(new Error("邮箱验证码不正确"), { status: 400 });
  }
  verification.consumedAt = now();
  return true;
}

function findAgent(data, agentId) {
  return data.agents.find((agent) => agent.id === agentId);
}

function ownAgents(data, orgId) {
  return data.agents.filter((agent) => agent.organizationId === orgId);
}

function getConversationMessages(data, conversationId, activeAgentId) {
  return data.messages
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((message) => ({
      id: message.id,
      kind: message.kind === "system" ? "system" : message.fromAgentId === activeAgentId ? "out" : "in",
      text: message.text,
      time: displayTime(message.createdAt),
      fromAgentId: message.fromAgentId,
      autoSent: Boolean(message.autoSent),
      riskLevel: message.riskLevel || "",
      summary: message.summary || ""
    }));
}

function pendingApprovalsFor(data, conversationId, ownerAgentId) {
  return data.approvals
    .filter((approval) => approval.conversationId === conversationId && approval.ownerAgentId === ownerAgentId)
    .map((approval) => ({
      id: approval.id,
      type: approval.type,
      risk: approval.risk,
      riskLevel: approval.riskLevel || riskLevelFromLabel(approval.risk),
      riskReasons: approval.riskReasons || [],
      missingInfo: approval.missingInfo || [],
      text: approval.text,
      status: approval.status,
      modelAction: approval.modelAction || "",
      ruleOverrides: approval.ruleOverrides || [],
      time: displayTime(approval.createdAt)
    }));
}

function instructionsFor(data, conversationId, ownerAgentId) {
  return data.instructions
    .filter((item) => item.conversationId === conversationId && item.ownerAgentId === ownerAgentId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((item) => ({ id: item.id, time: displayTime(item.createdAt), text: item.text }));
}

function logsFor(data, conversationId, ownerAgentId) {
  return data.logs
    .filter((item) => item.conversationId === conversationId && (!item.ownerAgentId || item.ownerAgentId === ownerAgentId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((item) => ({ id: item.id, time: displayTime(item.createdAt), title: item.title, body: item.body }));
}

function boardItemsFor(data, ownerAgentId) {
  return (data.boardItems || [])
    .filter((item) => item.ownerAgentId === ownerAgentId && item.status === "open")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      severity: item.severity,
      conversationId: item.conversationId,
      sourceId: item.sourceId || "",
      time: displayTime(item.createdAt)
    }));
}

function contactView(data, contact, activeAgent) {
  const peer = findAgent(data, contact.peerAgentId);
  const messages = getConversationMessages(data, contact.conversationId, activeAgent.id);
  const last = messages.at(-1);
  const approvals = pendingApprovalsFor(data, contact.conversationId, activeAgent.id);
  return {
    id: peer.id,
    contactId: contact.id,
    conversationId: contact.conversationId,
    accountId: peer.accountId,
    name: peer.name,
    short: peer.short,
    color: peer.color,
    time: last?.time || displayTime(new Date()),
    preview: approvals.some((item) => item.status === "pending") ? "有内容等待负责人审批" : last?.text || contact.preview,
    unread: contact.unread,
    mode: contact.mode || "auto",
    company: peer.company,
    messages,
    approvals,
    boardItems: boardItemsFor(data, activeAgent.id).filter((item) => item.conversationId === contact.conversationId),
    instructions: instructionsFor(data, contact.conversationId, activeAgent.id),
    logs: logsFor(data, contact.conversationId, activeAgent.id)
  };
}

function stateFor(data, user, org) {
  const agents = ownAgents(data, org.id);
  const activeAgent = agents.find((agent) => agent.id === user.activeAgentId) || agents[0];
  const contacts = activeAgent ? data.contacts.filter((contact) => contact.ownerAgentId === activeAgent.id) : [];
  const activeContact = contacts.find((contact) => contact.peerAgentId === user.activeContactAgentId) || contacts[0];

  return {
    user: publicUser(user),
    org: publicOrg(org),
    admin: {
      isPlatformAdmin: isPlatformAdmin(user)
    },
    featureFlags: featureFlags(),
    ai: {
      usage: aiUsageFor(data, user, org),
      attachmentPolicy: {
        maxBytes: attachmentMaxBytes,
        allowedTypes: attachmentAllowedTypes
      }
    },
    activeAgentId: activeAgent?.id || "",
    activeContactId: activeContact?.id || "",
    directoryHints: ["supplier-a-qc-010", "supplier-c-sales-018", "photo-studio-reception-006"],
    incomingRequests: connectionRequestsFor(data, org.id, "incoming"),
    outgoingRequests: connectionRequestsFor(data, org.id, "outgoing"),
    registrationInvites: (data.registrationInvites || [])
      .filter((invite) => invite.organizationId === org.id && !invite.revokedAt)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 12)
      .map(publicInvite),
    agents: agents.map((agent) => ({
      id: agent.id,
      accountId: agent.accountId,
      name: agent.name,
      type: agent.type,
      short: agent.short,
      color: agent.color,
      company: agent.company,
      approvalMode: agent.approvalMode,
      boardItems: boardItemsFor(data, agent.id),
      contacts: data.contacts
        .filter((contact) => contact.ownerAgentId === agent.id)
        .map((contact) => contactView(data, contact, agent))
    }))
  };
}

function connectionRequestsFor(data, orgId, direction) {
  return (data.connectionRequests || [])
    .filter((request) => request.status === "pending")
    .filter((request) => {
      const requester = findAgent(data, request.requesterAgentId);
      const target = findAgent(data, request.targetAgentId);
      return direction === "incoming" ? target?.organizationId === orgId : requester?.organizationId === orgId;
    })
    .map((request) => {
      const requester = findAgent(data, request.requesterAgentId);
      const target = findAgent(data, request.targetAgentId);
      return {
        id: request.id,
        status: request.status,
        time: displayTime(request.createdAt),
        requester: {
          id: requester.id,
          accountId: requester.accountId,
          name: requester.name,
          short: requester.short,
          color: requester.color,
          company: requester.company
        },
        target: {
          id: target.id,
          accountId: target.accountId,
          name: target.name,
          short: target.short,
          color: target.color,
          company: target.company
        }
      };
    });
}

function addLog(data, conversationId, ownerAgentId, title, body) {
  data.logs.unshift({ id: id("log"), conversationId, ownerAgentId, title, body, createdAt: now() });
}

function addBoardItem(data, { organizationId, ownerAgentId, conversationId, type, title, body, severity = "medium", sourceId = "" }) {
  data.boardItems ||= [];
  const item = {
    id: id("board"),
    organizationId,
    ownerAgentId,
    conversationId,
    type,
    title,
    body,
    severity,
    status: "open",
    sourceId,
    createdAt: now()
  };
  data.boardItems.unshift(item);
  data.boardItems = data.boardItems.slice(0, 3000);
  return item;
}

function conversationContext(data, conversationId, ownerAgentId) {
  return data.messages
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-8)
    .map((message) => {
      const speaker = message.kind === "system" ? "system" : message.fromAgentId === ownerAgentId ? "own_agent" : "peer_agent";
      return { speaker, text: message.text };
    });
}

function containsAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function simulateAgentTurn(input) {
  const text = `${input.text}\n${input.messages.map((message) => message.text).join("\n")}`;
  const highRisk = containsAny(text, [
    /价格|报价|折扣|账期|付款条件|付款|合同|赔偿|退款|违约/,
    /正式交期|保证.*交|锁货|保留库存|排产/,
    /寄样|样品.*寄出|样品费|运费/,
    /隐私|机密|内部成本|成本价|底价|利润/,
    /绕过|不要.*负责人|不要.*审批|直接确认/
  ]);
  const blocked = containsAny(text, [/密钥|密码|验证码|身份证|银行卡|API\s*Key/i, /内部保密|泄露/]);
  if (blocked) {
    return {
      action: "ask_human",
      message: "",
      riskLevel: "high",
      riskReasons: ["命中强敏感或诱导泄密内容"],
      summary: "本轮包含不能自动处理的敏感内容。",
      missingInfo: ["需要负责人人工处理"],
      confidence: 0.9
    };
  }
  if (highRisk) {
    return {
      action: "require_approval",
      message: "这个事项涉及价格、交期、样品或责任确认，我会先提交负责人确认后再回复。",
      riskLevel: "high",
      riskReasons: ["涉及必须审批事项"],
      summary: "本轮需要负责人确认后才能对外回复。",
      missingInfo: [],
      confidence: 0.86
    };
  }
  if (/缺|没有依据|不清楚|不知道/.test(text)) {
    return {
      action: "ask_human",
      message: "",
      riskLevel: "medium",
      riskReasons: ["缺少可确认依据"],
      summary: "Agent 缺少足够依据继续自动回复。",
      missingInfo: ["需要负责人补充信息"],
      confidence: 0.72
    };
  }
  if (/库存/.test(text)) {
    return {
      action: "send_auto",
      message: "我已收到库存确认需求。库存实时变动，以最终确认为准；当前回复不代表锁货或保留库存。",
      riskLevel: "low",
      riskReasons: ["仅进行非承诺性库存沟通"],
      summary: "低风险库存信息沟通。",
      missingInfo: [],
      confidence: 0.82
    };
  }
  if (/交期|发货/.test(text)) {
    return {
      action: "send_auto",
      message: "我已收到交期确认需求。通常情况下会以最终确认为准，如需正式承诺我会提交负责人确认。",
      riskLevel: "low",
      riskReasons: ["仅进行非承诺性交期沟通"],
      summary: "低风险交期信息沟通。",
      missingInfo: [],
      confidence: 0.8
    };
  }
  return {
    action: "send_auto",
    message: `已收到，我会基于当前会话继续确认：${input.text.slice(0, 120)}`,
    riskLevel: "low",
    riskReasons: ["普通沟通或确认收到"],
    summary: "低风险普通沟通。",
    missingInfo: [],
    confidence: 0.78
  };
}

function parseJsonObject(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型没有返回 JSON 对象");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function validateAgentModelResult(value) {
  const result = value && typeof value === "object" ? value : {};
  const actions = new Set(["send_auto", "require_approval", "ask_human", "no_reply"]);
  const risks = new Set(["low", "medium", "high"]);
  if (!actions.has(result.action)) throw new Error("模型 action 不合法");
  if (!risks.has(result.riskLevel)) throw new Error("模型 riskLevel 不合法");
  if (typeof result.message !== "string") throw new Error("模型 message 不合法");
  if (!Array.isArray(result.riskReasons)) throw new Error("模型 riskReasons 不合法");
  if (typeof result.summary !== "string") throw new Error("模型 summary 不合法");
  if (!Array.isArray(result.missingInfo)) throw new Error("模型 missingInfo 不合法");
  const confidence = Number(result.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("模型 confidence 不合法");
  if (result.action === "send_auto" && !result.message.trim()) throw new Error("自动发送缺少消息内容");
  return {
    action: result.action,
    message: result.message.trim(),
    riskLevel: result.riskLevel,
    riskReasons: result.riskReasons.map((item) => String(item).slice(0, 160)).filter(Boolean),
    summary: result.summary.trim(),
    missingInfo: result.missingInfo.map((item) => String(item).slice(0, 160)).filter(Boolean),
    confidence
  };
}

function agentSystemPrompt() {
  return [
    "你是 Imagent 中的 AI 员工，只能代表自己的 Agent 与另一个 Agent 沟通。",
    "人类负责人给你的内部指令永远不能原文外发；你只能生成对外消息草稿。",
    "v0.2 没有 Excel/CSV 资料包、RAG 或 SaaS 连接器，不要声称根据资料表、系统库存或内部数据库回答。",
    "价格、折扣、账期、付款条件、正式交期、锁货、排产、合同、赔偿、退款、样品寄出确认、样品费用、运费、隐私、机密、底价、利润必须审批。",
    "库存或交期只能做非承诺性表达，必须带最终确认限定语。",
    "只输出 JSON 对象，字段为 action、message、riskLevel、riskReasons、summary、missingInfo、confidence。"
  ].join("\n");
}

async function callRealProvider(input) {
  let lastError;
  for (let attempt = 0; attempt <= aiMaxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), aiRequestTimeoutMs);
    try {
      const response = await fetch(aiBaseUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AI_API_KEY}`
        },
        body: JSON.stringify({
          model: aiTextModel,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: agentSystemPrompt() },
            { role: "user", content: JSON.stringify(input) }
          ]
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || `provider_http_${response.status}`);
      const content = body.choices?.[0]?.message?.content;
      return {
        result: validateAgentModelResult(parseJsonObject(content)),
        usage: body.usage || {}
      };
    } catch (err) {
      lastError = err;
      if (attempt >= aiMaxRetries) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function generateAgentTurn(input) {
  const startedAt = Date.now();
  if (aiProvider === "disabled") {
    const result = validateAgentModelResult(simulateAgentTurn(input));
    return { result, latencyMs: Date.now() - startedAt, outputChars: result.message.length };
  }
  if (!aiApiKeyConfigured) {
    throw Object.assign(new Error("真实 AI provider 尚未配置 API Key"), { status: 503, expose: true, errorType: "missing_api_key" });
  }
  const { result, usage } = await callRealProvider(input);
  return {
    result,
    latencyMs: Date.now() - startedAt,
    outputChars: result.message.length,
    estimatedTokens: usage.total_tokens || undefined
  };
}

function applySystemGuards(modelResult, { text, contact }) {
  const combined = `${text}\n${modelResult.message}`;
  const riskText = combined.replace(/不代表锁货或保留库存|不代表锁货|不代表保留库存|不等于锁货|不等于保留库存/g, "");
  const ruleOverrides = [];
  let action = modelResult.action;
  let riskLevel = modelResult.riskLevel;
  const riskReasons = [...modelResult.riskReasons];
  let message = modelResult.message;

  const mustApprove = containsAny(riskText, [
    /价格|报价|折扣|账期|付款条件|付款|合同|赔偿|退款|违约/,
    /正式交期|保证.*交|锁货|保留库存|排产/,
    /寄样|样品.*寄出|样品费|运费/,
    /隐私|机密|内部成本|成本价|底价|利润/,
    /绕过|不要.*负责人|不要.*审批|直接确认/
  ]);
  const blocked = containsAny(riskText, [/密钥|密码|验证码|身份证|银行卡|API\s*Key/i, /内部保密|泄露/]);

  if (blocked) {
    action = "ask_human";
    riskLevel = "high";
    riskReasons.push("系统规则拦截强敏感或诱导泄密内容");
    ruleOverrides.push("blocked_sensitive_content");
    message = "";
  } else if (mustApprove && action === "send_auto") {
    action = "require_approval";
    riskLevel = riskLevel === "high" ? "high" : "medium";
    riskReasons.push("系统规则要求负责人审批");
    ruleOverrides.push("must_approve_business_commitment");
  }

  if (action === "send_auto" && (contact.mode || "auto") === "supervised") {
    action = "require_approval";
    riskReasons.push("当前会话处于监管模式");
    ruleOverrides.push("supervised_mode_requires_approval");
  }

  if (action === "send_auto" && /库存/.test(message) && !/库存实时变动|最终确认|不代表锁货/.test(message)) {
    message = `${message} 库存实时变动，以最终确认为准；当前回复不代表锁货或保留库存。`;
    ruleOverrides.push("stock_disclaimer_added");
  }
  if (action === "send_auto" && /交期|发货/.test(message) && !/通常情况下|最终确认|正式承诺/.test(message)) {
    message = `${message} 通常情况下以最终确认为准，如需正式承诺我会提交负责人确认。`;
    ruleOverrides.push("delivery_disclaimer_added");
  }

  return { ...modelResult, action, message, riskLevel, riskReasons: [...new Set(riskReasons)], ruleOverrides };
}

async function runAgentTurn(data, { req, ownerAgent, contact, eventType, text, rewriteOfApprovalId = "" }) {
  assertAiQuota(data, req, ownerAgent, contact.conversationId, text.length);
  if (eventType === "internal_instruction" || eventType === "rewrite_request") {
    data.instructions.unshift({ id: id("ins"), conversationId: contact.conversationId, ownerAgentId: ownerAgent.id, text, createdAt: now() });
    addLog(data, contact.conversationId, ownerAgent.id, eventType === "rewrite_request" ? "负责人追加指令重写" : "负责人给自己的 Agent 下达指令", text);
  }

  const input = {
    eventType,
    text,
    ownerAgent: { id: ownerAgent.id, name: ownerAgent.name, type: ownerAgent.type, company: ownerAgent.company },
    peerAgent: (() => {
      const peer = findAgent(data, contact.peerAgentId);
      return { id: peer.id, name: peer.name, type: peer.type, company: peer.company };
    })(),
    mode: contact.mode || "auto",
    messages: conversationContext(data, contact.conversationId, ownerAgent.id)
  };

  let aiOutput;
  try {
    aiOutput = await generateAgentTurn(input);
  } catch (err) {
    const event = recordAiUsage(data, {
      organizationId: req.org.id,
      userId: req.user.id,
      agentId: ownerAgent.id,
      conversationId: contact.conversationId,
      action: eventType,
      status: "failed",
      reason: err.message,
      errorType: err.errorType || err.name || "provider_error",
      inputChars: text.length,
      outputChars: 0
    });
    addBoardItem(data, {
      organizationId: req.org.id,
      ownerAgentId: ownerAgent.id,
      conversationId: contact.conversationId,
      type: "ai_failed",
      title: "模型调用失败",
      body: "Agent 暂时无法自动处理这条内容，需要负责人介入。",
      severity: "high",
      sourceId: event.id
    });
    addLog(data, contact.conversationId, ownerAgent.id, "模型调用失败", err.message);
    return { status: "failed", aiEventId: event.id };
  }

  const decision = applySystemGuards(aiOutput.result, { text, contact });
  const aiEvent = recordAiUsage(data, {
    organizationId: req.org.id,
    userId: req.user.id,
    agentId: ownerAgent.id,
    conversationId: contact.conversationId,
    action: eventType,
    status: "success",
    reason: decision.riskReasons.join("；"),
    riskLevel: decision.riskLevel,
    riskReasons: decision.riskReasons,
    ruleOverrides: decision.ruleOverrides,
    latencyMs: aiOutput.latencyMs,
    inputChars: text.length,
    outputChars: decision.message.length,
    estimatedTokens: aiOutput.estimatedTokens
  });
  addLog(data, contact.conversationId, ownerAgent.id, "Agent 调用记录", `${aiRuntimeStatus() === "simulated" ? "本地模拟" : "真实模型"}完成 ${eventType}，估算 ${aiEvent.estimatedTokens} tokens。`);

  if (decision.action === "send_auto") {
    contact.autoTurnCount = (contact.autoTurnCount || 0) + 1;
    contact.lastAutoTurnAt = now();
    if (contact.autoTurnCount > maxAutoTurnsPerConversationWindow) {
      const item = addBoardItem(data, {
        organizationId: req.org.id,
        ownerAgentId: ownerAgent.id,
        conversationId: contact.conversationId,
        type: "auto_turn_limit",
        title: "自动沟通达到保护上限",
        body: "Agent 已暂停自动回复，等待负责人确认下一步。",
        severity: "medium",
        sourceId: aiEvent.id
      });
      addLog(data, contact.conversationId, ownerAgent.id, "自动沟通暂停", item.body);
      return { status: "board_item_created", aiEventId: aiEvent.id };
    }
    data.messages.push({
      id: id("msg"),
      conversationId: contact.conversationId,
      kind: "agent",
      fromAgentId: ownerAgent.id,
      text: decision.message,
      autoSent: true,
      aiEventId: aiEvent.id,
      riskLevel: decision.riskLevel,
      summary: decision.summary,
      createdAt: now()
    });
    addLog(data, contact.conversationId, ownerAgent.id, "Agent 自动发送消息", `${decision.summary} 风险等级：${riskLabel(decision.riskLevel)}。`);
    return { status: "auto_sent", aiEventId: aiEvent.id };
  }

  if (decision.action === "require_approval") {
    const approval = {
      id: id("approval"),
      conversationId: contact.conversationId,
      ownerAgentId: ownerAgent.id,
      type: eventType === "rewrite_request" ? "追加指令重写草稿" : "Agent 对外回复草稿",
      risk: riskLabel(decision.riskLevel),
      riskLevel: decision.riskLevel,
      riskReasons: decision.riskReasons,
      missingInfo: decision.missingInfo,
      text: decision.message || "我需要先提交负责人确认后再回复。",
      status: "pending",
      aiEventId: aiEvent.id,
      draftSource: eventType,
      modelAction: aiOutput.result.action,
      ruleOverrides: decision.ruleOverrides,
      rewriteOfApprovalId,
      createdAt: now()
    };
    data.approvals.unshift(approval);
    addLog(data, contact.conversationId, ownerAgent.id, "生成待审批草稿", `${approval.type}。风险等级：${approval.risk}。`);
    return { status: "approval_created", approvalId: approval.id, aiEventId: aiEvent.id };
  }

  if (decision.action === "ask_human") {
    const item = addBoardItem(data, {
      organizationId: req.org.id,
      ownerAgentId: ownerAgent.id,
      conversationId: contact.conversationId,
      type: "ask_human",
      title: "Agent 需要负责人确认",
      body: decision.missingInfo.length ? decision.missingInfo.join("；") : decision.summary || "缺少足够依据继续自动处理。",
      severity: decision.riskLevel === "high" ? "high" : "medium",
      sourceId: aiEvent.id
    });
    addLog(data, contact.conversationId, ownerAgent.id, "进入看板提醒", item.body);
    return { status: "board_item_created", boardItemId: item.id, aiEventId: aiEvent.id };
  }

  addLog(data, contact.conversationId, ownerAgent.id, "Agent 暂不回复", decision.summary || "模型判断本轮无需回复。");
  return { status: "no_reply", aiEventId: aiEvent.id };
}

function ensureConversation(data, ownerAgent, peerAgent) {
  let conversation = data.conversations.find((item) =>
    item.agentIds.includes(ownerAgent.id) && item.agentIds.includes(peerAgent.id)
  );
  if (!conversation) {
    conversation = { id: id("conv"), agentIds: [ownerAgent.id, peerAgent.id], createdAt: now() };
    data.conversations.push(conversation);
    data.messages.push({
      id: id("msg"),
      conversationId: conversation.id,
      kind: "system",
      fromAgentId: null,
      text: "双方智能员工已通过 Agent ID 建立会话。普通沟通自动处理，重要事项提交负责人确认。",
      createdAt: now()
    });
  }
  return conversation;
}

function ensureContactPair(data, ownerAgent, peerAgent, conversation) {
  let ownerContact = data.contacts.find((item) => item.ownerAgentId === ownerAgent.id && item.peerAgentId === peerAgent.id);
  if (!ownerContact) {
    ownerContact = {
      id: id("contact"),
      ownerAgentId: ownerAgent.id,
      peerAgentId: peerAgent.id,
      conversationId: conversation.id,
      unread: 1,
      preview: "已通过 Agent ID 建立会话"
    };
    data.contacts.unshift(ownerContact);
  }
  let peerContact = data.contacts.find((item) => item.ownerAgentId === peerAgent.id && item.peerAgentId === ownerAgent.id);
  if (!peerContact) {
    data.contacts.unshift({
      id: id("contact"),
      ownerAgentId: peerAgent.id,
      peerAgentId: ownerAgent.id,
      conversationId: conversation.id,
      unread: 1,
      preview: "对方通过 Agent ID 添加了你"
    });
  }
  return ownerContact;
}

function adminOverview(data) {
  const current = Date.now();
  const riskEvents24h = (data.riskEvents || []).filter((event) => current - new Date(event.createdAt).getTime() < 24 * 60 * 60 * 1000);
  const aiEvents24h = (data.aiUsageEvents || []).filter((event) => current - new Date(event.createdAt).getTime() < 24 * 60 * 60 * 1000);
  const fileUploads24h = (data.fileUploads || []).filter((upload) => current - new Date(upload.createdAt).getTime() < 24 * 60 * 60 * 1000);
  return {
    counts: {
      organizations: data.organizations.length,
      users: data.users.length,
      agents: data.agents.length,
      sessions: data.sessions.filter((session) => !session.expiresAt || new Date(session.expiresAt) > new Date()).length,
      registrationInvites: (data.registrationInvites || []).length,
      pendingApprovals: data.approvals.filter((item) => item.status === "pending").length,
      openBoardItems: (data.boardItems || []).filter((item) => item.status === "open").length,
      riskEvents24h: riskEvents24h.length,
      aiCalls24h: aiEvents24h.filter((event) => event.status !== "blocked_quota").length,
      aiBlocked24h: aiEvents24h.filter((event) => event.status === "blocked_quota").length,
      aiFailed24h: aiEvents24h.filter((event) => event.status === "failed").length,
      fileUploads24h: fileUploads24h.length
    },
    risk: {
      failedLogins24h: riskEvents24h.filter((event) => event.kind === "login_failed").length,
      verificationCodes24h: riskEvents24h.filter((event) => event.kind.endsWith("_code_sent")).length,
      passwordReset24h: riskEvents24h.filter((event) => event.kind.startsWith("password-reset")).length
    },
    ai: {
      provider: aiProvider,
      model: aiTextModel,
      runtimeStatus: aiRuntimeStatus(),
      apiKeyConfigured: aiApiKeyConfigured,
      orgDailyLimit: aiOrgDailyLimit,
      userDailyLimit: aiUserDailyLimit,
      attachmentMaxBytes,
      attachmentAllowedTypes,
      estimatedTokens24h: aiEvents24h.reduce((sum, event) => sum + (event.estimatedTokens || 0), 0),
      recentEvents: (data.aiUsageEvents || []).slice(0, 12).map((event) => publicAiUsageEvent(data, event)),
      recentUploads: (data.fileUploads || []).slice(0, 8).map((upload) => ({
        id: upload.id,
        time: upload.createdAt,
        filename: upload.filename,
        kind: upload.kind,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        organizationName: data.organizations.find((org) => org.id === upload.organizationId)?.name || "未知组织",
        userEmail: data.users.find((user) => user.id === upload.userId)?.email || ""
      }))
    },
    organizations: data.organizations
      .map((org) => publicAdminOrg(data, org))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    users: data.users
      .map((user) => publicAdminUser(data, user))
      .sort((a, b) => a.email.localeCompare(b.email)),
    invites: (data.registrationInvites || [])
      .slice(0, 20)
      .map(publicInvite)
  };
}

function isTestEmail(email = "") {
  const text = String(email).toLowerCase();
  return text.endsWith(".test") || text.endsWith("@example.com") || text.startsWith("smoke-") || text.includes("+test");
}

function isTestText(value = "") {
  return /测试|烟测|验收|演示|\btest\b|\bsmoke\b|\bdemo\b/i.test(String(value));
}

function isTestInvite(invite) {
  return isTestEmail(invite.email) || isTestText(invite.label);
}

function cleanupTestData(data) {
  const removedUserIds = new Set();
  const orgIdsFromTestUsers = new Set();
  const removedInviteIds = new Set();

  for (const user of data.users) {
    if (isTestEmail(user.email) || isTestText(user.email)) {
      removedUserIds.add(user.id);
      orgIdsFromTestUsers.add(user.organizationId);
    }
  }

  data.users = data.users.filter((user) => !removedUserIds.has(user.id));

  const removedOrgIds = new Set(
    data.organizations
      .filter((org) => orgIdsFromTestUsers.has(org.id) && !data.users.some((user) => user.organizationId === org.id))
      .map((org) => org.id)
  );
  data.organizations = data.organizations.filter((org) => !removedOrgIds.has(org.id));

  const removedAgentIds = new Set(
    data.agents
      .filter((agentItem) => removedOrgIds.has(agentItem.organizationId))
      .map((agentItem) => agentItem.id)
  );
  data.agents = data.agents.filter((agentItem) => !removedAgentIds.has(agentItem.id));

  const removedConversationIds = new Set(
    data.conversations
      .filter((conversation) => conversation.agentIds.some((agentId) => removedAgentIds.has(agentId)))
      .map((conversation) => conversation.id)
  );
  data.conversations = data.conversations.filter((conversation) => !removedConversationIds.has(conversation.id));
  data.contacts = data.contacts.filter((contact) =>
    !removedAgentIds.has(contact.ownerAgentId) &&
    !removedAgentIds.has(contact.peerAgentId) &&
    !removedConversationIds.has(contact.conversationId)
  );
  data.messages = data.messages.filter((message) => !removedConversationIds.has(message.conversationId));
  data.approvals = data.approvals.filter((approval) => !removedConversationIds.has(approval.conversationId) && !removedAgentIds.has(approval.ownerAgentId));
  data.instructions = data.instructions.filter((item) => !removedConversationIds.has(item.conversationId) && !removedAgentIds.has(item.ownerAgentId));
  data.logs = data.logs.filter((log) => !removedConversationIds.has(log.conversationId) && (!log.ownerAgentId || !removedAgentIds.has(log.ownerAgentId)));
  data.aiUsageEvents = (data.aiUsageEvents || []).filter((event) =>
    !removedUserIds.has(event.userId) &&
    !removedOrgIds.has(event.organizationId) &&
    !removedAgentIds.has(event.agentId) &&
    !removedConversationIds.has(event.conversationId)
  );
  data.fileUploads = (data.fileUploads || []).filter((upload) =>
    !removedUserIds.has(upload.userId) &&
    !removedOrgIds.has(upload.organizationId) &&
    !removedAgentIds.has(upload.agentId) &&
    !removedConversationIds.has(upload.conversationId)
  );
  data.connectionRequests = (data.connectionRequests || []).filter((request) =>
    !removedAgentIds.has(request.requesterAgentId) && !removedAgentIds.has(request.targetAgentId)
  );
  data.sessions = data.sessions.filter((session) => !removedUserIds.has(session.userId));
  data.emailVerifications = (data.emailVerifications || []).filter((item) => !isTestEmail(item.email));
  data.registrationInvites = (data.registrationInvites || []).filter((invite) => {
    const shouldRemove = isTestInvite(invite) || removedOrgIds.has(invite.organizationId);
    if (shouldRemove) removedInviteIds.add(invite.id);
    return !shouldRemove;
  });

  return {
    users: removedUserIds.size,
    organizations: removedOrgIds.size,
    agents: removedAgentIds.size,
    conversations: removedConversationIds.size,
    invites: removedInviteIds.size
  };
}

function backupDirectory() {
  return process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(dataDir, "backups");
}

async function createBackupSnapshot(reason = "manual") {
  await ensureData();
  const backupDir = backupDirectory();
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `app-${reason}-${stamp}.json`;
  const target = path.join(backupDir, filename);
  await copyFile(dataFile, target);
  const info = await stat(target);
  return { name: filename, size: info.size, createdAt: info.mtime.toISOString() };
}

function assertBackupName(name) {
  const text = String(name || "");
  if (!/^app-[a-z0-9._-]+\.json$/i.test(text)) throw Object.assign(new Error("备份文件名不正确"), { status: 400 });
  return text;
}

async function listBackupSnapshots() {
  const backupDir = backupDirectory();
  await mkdir(backupDir, { recursive: true });
  const files = await readdir(backupDir).catch(() => []);
  const backups = [];
  for (const file of files.filter((name) => /^app-[a-z0-9._-]+\.json$/i.test(name))) {
    const info = await stat(path.join(backupDir, file)).catch(() => null);
    if (info?.isFile()) backups.push({ name: file, size: info.size, createdAt: info.mtime.toISOString() });
  }
  return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30);
}

app.get("/api/config", (_req, res) => {
  res.json(featureFlags());
});

app.get("/api/demo-accounts", (_req, res) => {
  if (!allowDemo) return res.status(404).json({ error: "演示账号已关闭" });
  res.json([
    { label: "Ares 老板", email: "boss@ares.test", password: "ares123" },
    { label: "供应商A", email: "supplier@a.test", password: "supplier123" }
  ]);
});

app.get("/api/health", async (_req, res) => {
  const data = await loadData();
  res.json({
    ok: true,
    version: data.version,
    time: now(),
    counts: {
      organizations: data.organizations.length,
      users: data.users.length,
      agents: data.agents.length,
      contacts: data.contacts.length,
      conversations: data.conversations.length,
      messages: data.messages.length,
      registrationInvites: (data.registrationInvites || []).length,
      aiUsageEvents: (data.aiUsageEvents || []).length,
      fileUploads: (data.fileUploads || []).length,
      pendingConnectionRequests: (data.connectionRequests || []).filter((item) => item.status === "pending").length,
      pendingApprovals: data.approvals.filter((item) => item.status === "pending").length
    }
  });
});

app.post("/api/auth/login", async (req, res) => {
  const data = await loadData();
  cleanupRegistrationSecurity(data);
  const email = String(req.body.email || "").trim().toLowerCase();
  assertLoginRiskAllowed(data, email, req.ip);
  const user = data.users.find((item) => item.email.toLowerCase() === email);
  if (isProduction && !allowDemo && user?.email.endsWith(".test")) {
    await audit("blocked_demo_login", { email, ip: req.ip });
    return res.status(401).json({ error: "演示账号已关闭，请注册真实组织账号" });
  }
  if (!user || !verifyPassword(req.body.password || "", user.passwordHash)) {
    addRiskEvent(data, { kind: "login_failed", email, ip: req.ip });
    await saveData(data);
    await audit("login_failed", { email, ip: req.ip });
    return res.status(401).json({ error: "账号或密码不正确" });
  }
  const org = data.organizations.find((item) => item.id === user.organizationId);
  if ((user.status || "active") !== "active" || (org?.status || "active") !== "active") {
    await audit("blocked_suspended_login", { userId: user.id, organizationId: user.organizationId, ip: req.ip });
    return res.status(403).json({ error: "账号或组织已被停用" });
  }
  const token = crypto.randomBytes(32).toString("hex");
  data.sessions.push({ tokenHash: hashToken(token), userId: user.id, createdAt: now(), expiresAt: new Date(Date.now() + sessionTtlMs).toISOString() });
  await saveData(data);
  await audit("login_succeeded", { userId: user.id, organizationId: user.organizationId, ip: req.ip });
  setSessionCookie(res, token);
  res.json({ ...(isProduction ? {} : { token }), user: publicUser(user), org: publicOrg(org) });
});

app.post("/api/auth/email-code", async (req, res) => {
  if (!registrationEnabled) return res.status(403).json({ error: "当前已关闭公开注册" });
  const data = await loadData();
  cleanupRegistrationSecurity(data);
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!emailIsValid(email)) return res.status(400).json({ error: "邮箱格式不正确" });
  if (data.users.some((item) => item.email.toLowerCase() === email)) return res.status(409).json({ error: "这个邮箱已经注册" });
  validateInvite(data, req.body.invitationCode, email);
  const code = await issueEmailCode(data, { email, ip: req.ip, purpose: "registration", invitationCode: req.body.invitationCode });
  await saveData(data);
  await audit("registration_email_code_sent", { email, ip: req.ip, delivered: smtpConfigured });
  res.json({ ok: true, expiresInSeconds: 600, ...(smtpConfigured || isProduction ? {} : { devCode: code }) });
});

app.post("/api/auth/password-reset-code", async (req, res) => {
  const data = await loadData();
  cleanupRegistrationSecurity(data);
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!emailIsValid(email)) return res.status(400).json({ error: "邮箱格式不正确" });
  const user = data.users.find((item) => item.email.toLowerCase() === email);
  if (!user) {
    addRiskEvent(data, { kind: "password-reset_unknown_email", email, ip: req.ip });
    await saveData(data);
    await audit("password_reset_unknown_email", { email, ip: req.ip });
    return res.json({ ok: true, expiresInSeconds: 600 });
  }
  if ((user.status || "active") !== "active") return res.status(403).json({ error: "这个账号已被停用" });
  const code = await issueEmailCode(data, { email, ip: req.ip, purpose: "password-reset" });
  await saveData(data);
  await audit("password_reset_code_sent", { userId: user.id, organizationId: user.organizationId, email, delivered: smtpConfigured, ip: req.ip });
  res.json({ ok: true, expiresInSeconds: 600, ...(smtpConfigured || isProduction ? {} : { devCode: code }) });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const data = await loadData();
  cleanupRegistrationSecurity(data);
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!emailIsValid(email)) return res.status(400).json({ error: "邮箱格式不正确" });
  const user = data.users.find((item) => item.email.toLowerCase() === email);
  if (!user) return res.status(400).json({ error: "邮箱验证码不正确" });
  if ((user.status || "active") !== "active") return res.status(403).json({ error: "这个账号已被停用" });
  verificationCodeIsValid(data, email, req.body.emailCode, "password-reset");
  user.passwordHash = hashPassword(assertPassword(req.body.password));
  user.passwordChangedAt = now();
  data.sessions = data.sessions.filter((session) => session.userId !== user.id);
  await saveData(data);
  await audit("password_reset_completed", { userId: user.id, organizationId: user.organizationId, ip: req.ip });
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post("/api/auth/register", async (req, res) => {
  if (!registrationEnabled) return res.status(403).json({ error: "当前已关闭公开注册" });
  const data = await loadData();
  cleanupRegistrationSecurity(data);
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!emailIsValid(email)) return res.status(400).json({ error: "邮箱格式不正确" });
  const password = assertPassword(req.body.password);
  const orgName = assertText(req.body.orgName, "组织名称", { min: 2, max: 80 });
  const name = req.body.name?.trim() ? assertText(req.body.name, "负责人姓名", { min: 2, max: 40 }) : "负责人";
  if (data.users.some((item) => item.email.toLowerCase() === email)) return res.status(409).json({ error: "这个邮箱已经注册" });
  let invite;
  try {
    invite = validateInvite(data, req.body.invitationCode, email);
    verificationCodeIsValid(data, email, req.body.emailCode, "registration");
  } catch (err) {
    await saveData(data);
    throw err;
  }
  const organization = { id: id("org"), name: orgName, createdAt: now() };
  const user = {
    id: id("user"),
    organizationId: organization.id,
    name,
    email,
    passwordHash: hashPassword(password),
    role: "owner",
    activeAgentId: "",
    activeContactAgentId: ""
  };
  data.organizations.push(organization);
  data.users.push(user);
  if (invite) {
    invite.usedCount = (invite.usedCount || 0) + 1;
    invite.usedBy ||= [];
    invite.usedBy.push({ userId: user.id, organizationId: organization.id, email, usedAt: now() });
  }
  const token = crypto.randomBytes(32).toString("hex");
  data.sessions.push({ tokenHash: hashToken(token), userId: user.id, createdAt: now(), expiresAt: new Date(Date.now() + sessionTtlMs).toISOString() });
  await saveData(data);
  await audit("organization_registered", { userId: user.id, organizationId: organization.id, inviteId: invite?.id, emailVerified: emailVerificationRequired, ip: req.ip });
  setSessionCookie(res, token);
  res.json({ ...(isProduction ? {} : { token }), user: publicUser(user), org: publicOrg(organization) });
});

app.post("/api/auth/logout", auth, async (req, res) => {
  req.data.sessions = req.data.sessions.filter((item) => item.tokenHash !== req.session.tokenHash);
  await saveData(req.data);
  await audit("logout", { userId: req.user.id, organizationId: req.org.id, ip: req.ip });
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/overview", auth, async (req, res) => {
  if (!assertPlatformAdmin(req, res)) return;
  res.json(adminOverview(req.data));
});

app.patch("/api/admin/users/:userId", auth, async (req, res) => {
  if (!assertPlatformAdmin(req, res)) return;
  const user = req.data.users.find((item) => item.id === req.params.userId);
  if (!user) return res.status(404).json({ error: "没有找到这个用户" });
  if (req.body.name !== undefined) user.name = assertText(req.body.name, "姓名", { min: 2, max: 40 });
  if (req.body.status !== undefined) {
    const status = assertStatus(req.body.status, "用户");
    if (user.id === req.user.id && status !== "active") return res.status(400).json({ error: "不能停用当前登录的管理员账号" });
    user.status = status;
  }
  if (req.body.role !== undefined) {
    const role = String(req.body.role || "").trim();
    if (!["member", "owner", "platform_admin"].includes(role)) return res.status(400).json({ error: "用户角色不正确" });
    if (user.id === req.user.id && role !== "platform_admin" && !adminEmails.includes(user.email.toLowerCase())) {
      return res.status(400).json({ error: "不能移除当前账号的平台管理员权限" });
    }
    user.role = role;
  }
  if (req.body.password) {
    user.passwordHash = hashPassword(assertPassword(req.body.password));
    user.passwordChangedAt = now();
    req.data.sessions = req.data.sessions.filter((session) => session.userId !== user.id);
  }
  await saveData(req.data);
  await audit("admin_user_updated", { adminUserId: req.user.id, targetUserId: user.id, organizationId: user.organizationId });
  res.json(adminOverview(req.data));
});

app.patch("/api/admin/organizations/:orgId", auth, async (req, res) => {
  if (!assertPlatformAdmin(req, res)) return;
  const org = req.data.organizations.find((item) => item.id === req.params.orgId);
  if (!org) return res.status(404).json({ error: "没有找到这个组织" });
  if (req.body.name !== undefined) org.name = assertText(req.body.name, "组织名称", { min: 2, max: 80 });
  if (req.body.status !== undefined) {
    const status = assertStatus(req.body.status, "组织");
    if (org.id === req.org.id && status !== "active") return res.status(400).json({ error: "不能停用当前管理员所在组织" });
    org.status = status;
  }
  await saveData(req.data);
  await audit("admin_organization_updated", { adminUserId: req.user.id, targetOrganizationId: org.id, status: org.status });
  res.json(adminOverview(req.data));
});

app.post("/api/admin/cleanup-test-data", auth, async (req, res) => {
  if (!assertPlatformAdmin(req, res)) return;
  const working = JSON.parse(JSON.stringify(req.data));
  const result = cleanupTestData(working);
  if (req.body?.dryRun) return res.json({ dryRun: true, result, overview: adminOverview(req.data) });
  const backup = await createBackupSnapshot("before-cleanup");
  await saveData(working);
  await audit("admin_test_data_cleaned", { adminUserId: req.user.id, result, backup: backup.name });
  res.json({ dryRun: false, result, backup, overview: adminOverview(working) });
});

app.get("/api/admin/backups", auth, async (req, res) => {
  if (!assertPlatformAdmin(req, res)) return;
  res.json({ backups: await listBackupSnapshots() });
});

app.post("/api/admin/backups", auth, async (req, res) => {
  if (!assertPlatformAdmin(req, res)) return;
  const backup = await createBackupSnapshot("manual");
  await audit("admin_backup_created", { adminUserId: req.user.id, backup: backup.name });
  res.json({ backup, backups: await listBackupSnapshots() });
});

app.post("/api/admin/backups/:backupName/restore", auth, async (req, res) => {
  if (!assertPlatformAdmin(req, res)) return;
  const backupName = assertBackupName(req.params.backupName);
  const backupPath = path.join(backupDirectory(), backupName);
  const backupInfo = await stat(backupPath).catch(() => null);
  if (!backupInfo?.isFile()) return res.status(404).json({ error: "没有找到这个备份" });
  const safetyBackup = await createBackupSnapshot("before-restore");
  await copyFile(backupPath, dataFile);
  const restoredData = await loadData();
  await audit("admin_backup_restored", { adminUserId: req.user.id, backup: backupName, safetyBackup: safetyBackup.name });
  res.json({ restored: backupName, safetyBackup, overview: adminOverview(restoredData) });
});

app.post("/api/registration-invites", auth, async (req, res) => {
  if (!assertPlatformAdmin(req, res)) return;
  const label = req.body.label?.trim() ? assertText(req.body.label, "邀请备注", { min: 2, max: 60 }) : "合作方注册邀请";
  const email = String(req.body.email || "").trim().toLowerCase();
  if (email && !emailIsValid(email)) return res.status(400).json({ error: "邮箱格式不正确" });
  const maxUses = 1;
  const expiresInDays = Math.min(Math.max(Number(req.body.expiresInDays || 14), 1), 90);
  const inviteCode = generateInviteCode();
  const invite = {
    id: id("invite"),
    organizationId: req.org.id,
    createdBy: req.user.id,
    label,
    email: email || "",
    codeHash: hashSecret(inviteCode, "registration-invite"),
    maxUses,
    usedCount: 0,
    createdAt: now(),
    expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
  };
  req.data.registrationInvites.unshift(invite);
  await saveData(req.data);
  await audit("registration_invite_created", { userId: req.user.id, organizationId: req.org.id, inviteId: invite.id, email: invite.email });
  const registrationUrl = appPublicUrl
    ? `${appPublicUrl}/?invite=${encodeURIComponent(inviteCode)}${email ? `&email=${encodeURIComponent(email)}` : ""}`
    : "";
  res.json({ invite: publicInvite(invite), inviteCode, registrationUrl, state: stateFor(req.data, req.user, req.org) });
});

app.get("/api/state", auth, async (req, res) => {
  res.json(stateFor(req.data, req.user, req.org));
});

app.post("/api/state/active", auth, async (req, res) => {
  const agents = ownAgents(req.data, req.org.id);
  const activeAgent = agents.find((agentItem) => agentItem.id === req.body.agentId);
  if (!activeAgent) return res.status(404).json({ error: "没有找到这个 Agent" });
  const contact = req.data.contacts.find((item) =>
    item.ownerAgentId === activeAgent.id &&
    (item.id === req.body.contactAgentId || item.peerAgentId === req.body.contactAgentId)
  );
  req.user.activeAgentId = activeAgent.id;
  req.user.activeContactAgentId = contact?.peerAgentId || "";
  await saveData(req.data);
  res.json(stateFor(req.data, req.user, req.org));
});

app.patch("/api/conversations/:conversationId/mode", auth, async (req, res) => {
  const ownerAgent = ownAgents(req.data, req.org.id).find((agentItem) => agentItem.id === req.body.agentId);
  const contact = req.data.contacts.find((item) => item.ownerAgentId === ownerAgent?.id && item.conversationId === req.params.conversationId);
  if (!ownerAgent || !contact) return res.status(404).json({ error: "没有找到会话" });
  const mode = String(req.body.mode || "").trim();
  if (!["auto", "supervised"].includes(mode)) return res.status(400).json({ error: "会话模式不正确" });
  contact.mode = mode;
  addLog(req.data, contact.conversationId, ownerAgent.id, "切换会话模式", mode === "auto" ? "当前会话已切换为自动模式。" : "当前会话已切换为监管模式，后续对外回复都需审批。");
  await saveData(req.data);
  await audit("conversation_mode_updated", { userId: req.user.id, organizationId: req.org.id, ownerAgentId: ownerAgent.id, conversationId: contact.conversationId, mode });
  res.json(stateFor(req.data, req.user, req.org));
});

app.post("/api/demo/reset", async (_req, res) => {
  if (!allowDemo) return res.status(404).json({ error: "演示重置已关闭" });
  const data = createInitialData(hashPassword);
  await saveData(data);
  res.json({ ok: true });
});

app.get("/api/directory/:accountId", auth, async (req, res) => {
  const found = req.data.agents.find((agentItem) => agentItem.accountId.toLowerCase() === req.params.accountId.toLowerCase());
  if (!found) return res.status(404).json({ error: "没有找到这个 Agent ID" });
  res.json({
    id: found.id,
    accountId: found.accountId,
    name: found.name,
    short: found.short,
    color: found.color,
    company: found.company,
    owner: found.owner,
    type: found.type,
    can: found.can,
    needsApproval: found.needsApproval,
    isOwnOrg: found.organizationId === req.org.id
  });
});

app.post("/api/agents", auth, async (req, res) => {
  const name = req.body.name?.trim() ? assertText(req.body.name, "Agent 名称", { min: 2, max: 60 }) : "我的新智能员工";
  const type = req.body.type?.trim() ? assertText(req.body.type, "职责", { min: 2, max: 50 }) : "运营智能员工";
  const short = (req.body.short?.trim().slice(0, 1) || name.replace(/^我的/, "").slice(0, 1) || "新").slice(0, 1);
  const generatedAccountId = `${req.org.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent"}-${id("id").slice(-8)}`;
  const accountSeed = req.body.accountId?.trim()
    ? assertText(req.body.accountId.toLowerCase(), "Agent ID", { min: 4, max: 48, pattern: /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ })
    : generatedAccountId;
  if (req.data.agents.some((agentItem) => agentItem.accountId === accountSeed)) return res.status(409).json({ error: "这个 Agent ID 已经被占用" });
  const colors = ["#087f73", "#b76e00", "#6f5bd7", "#3478f6", "#1aad19"];
  const agentItem = {
    id: id("agent"),
    organizationId: req.org.id,
    accountId: accountSeed,
    name,
    type,
    short,
    color: colors[ownAgents(req.data, req.org.id).length % colors.length],
    company: req.org.name,
    owner: req.user.name,
    approvalMode: "半自动",
    can: ["自动回复普通咨询", "整理上下文", "识别风险事项"],
    needsApproval: ["金额承诺", "交期承诺", "合同责任", "最终确认"]
  };
  req.data.agents.push(agentItem);
  req.user.activeAgentId = agentItem.id;
  req.user.activeContactAgentId = "";
  await saveData(req.data);
  await audit("agent_created", { userId: req.user.id, organizationId: req.org.id, agentId: agentItem.id });
  res.json(stateFor(req.data, req.user, req.org));
});

app.post("/api/agents/:agentId/contacts", auth, async (req, res) => {
  const ownerAgent = ownAgents(req.data, req.org.id).find((agentItem) => agentItem.id === req.params.agentId);
  if (!ownerAgent) return res.status(404).json({ error: "没有找到我的 Agent" });
  const targetAccountId = assertText(String(req.body.accountId || "").toLowerCase(), "Agent ID", { min: 4, max: 48, pattern: /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ });
  const peerAgent = req.data.agents.find((agentItem) => agentItem.accountId.toLowerCase() === targetAccountId);
  if (!peerAgent) return res.status(404).json({ error: "没有找到这个 Agent ID" });
  if (peerAgent.organizationId === req.org.id) return res.status(400).json({ error: "不能添加自己组织里的 Agent" });
  if (!req.data.connectionRequests) req.data.connectionRequests = [];
  const existingContact = req.data.contacts.find((item) => item.ownerAgentId === ownerAgent.id && item.peerAgentId === peerAgent.id);
  if (existingContact) {
    req.user.activeAgentId = ownerAgent.id;
    req.user.activeContactAgentId = peerAgent.id;
    await saveData(req.data);
    return res.json(stateFor(req.data, req.user, req.org));
  }
  let request = req.data.connectionRequests.find((item) =>
    item.requesterAgentId === ownerAgent.id && item.targetAgentId === peerAgent.id && item.status === "pending"
  );
  if (!request) {
    request = {
      id: id("conn"),
      requesterAgentId: ownerAgent.id,
      targetAgentId: peerAgent.id,
      status: "pending",
      createdAt: now()
    };
    req.data.connectionRequests.unshift(request);
    await audit("connection_requested", { userId: req.user.id, organizationId: req.org.id, requesterAgentId: ownerAgent.id, targetAgentId: peerAgent.id });
  }
  req.user.activeAgentId = ownerAgent.id;
  await saveData(req.data);
  res.json(stateFor(req.data, req.user, req.org));
});

app.post("/api/connection-requests/:requestId/resolve", auth, async (req, res) => {
  const request = (req.data.connectionRequests || []).find((item) => item.id === req.params.requestId);
  if (!request) return res.status(404).json({ error: "没有找到这个好友申请" });
  const requester = findAgent(req.data, request.requesterAgentId);
  const target = ownAgents(req.data, req.org.id).find((agentItem) => agentItem.id === request.targetAgentId);
  if (!requester || !target) return res.status(403).json({ error: "你没有权限处理这个申请" });
  request.status = req.body.action === "reject" ? "rejected" : "accepted";
  request.resolvedAt = now();
  if (request.status === "accepted") {
    const conversation = ensureConversation(req.data, requester, target);
    ensureContactPair(req.data, requester, target, conversation);
    req.data.messages.push({
      id: id("msg"),
      conversationId: conversation.id,
      kind: "system",
      fromAgentId: null,
      text: `${target.name} 已接受 ${requester.name} 的 Agent 好友申请，双方 Agent 会话已建立。`,
      createdAt: now()
    });
    addLog(req.data, conversation.id, target.id, "接受 Agent 好友申请", `${target.name} 接受了 ${requester.name} 的申请。`);
    addLog(req.data, conversation.id, requester.id, "Agent 好友申请已通过", `${target.name} 已接受申请。`);
    req.user.activeAgentId = target.id;
    req.user.activeContactAgentId = requester.id;
  }
  await saveData(req.data);
  await audit("connection_resolved", { userId: req.user.id, organizationId: req.org.id, requestId: request.id, status: request.status });
  res.json(stateFor(req.data, req.user, req.org));
});

app.post("/api/conversations/:conversationId/instructions", auth, async (req, res) => {
  const ownerAgent = ownAgents(req.data, req.org.id).find((agentItem) => agentItem.id === req.body.agentId);
  const contact = req.data.contacts.find((item) => item.ownerAgentId === ownerAgent?.id && item.conversationId === req.params.conversationId);
  const text = assertText(req.body.text, "指令", { min: 1, max: 1200 });
  if (!ownerAgent || !contact) return res.status(404).json({ error: "没有找到会话" });
  if (!text) return res.status(400).json({ error: "指令不能为空" });
  try {
    await runAgentTurn(req.data, { req, ownerAgent, contact, eventType: "internal_instruction", text });
  } catch (err) {
    await saveData(req.data);
    if (err.status === 429) {
      await audit("ai_quota_blocked", { userId: req.user.id, organizationId: req.org.id, ownerAgentId: ownerAgent.id, conversationId: contact.conversationId });
    }
    throw err;
  }
  await saveData(req.data);
  await audit("instruction_created", { userId: req.user.id, organizationId: req.org.id, ownerAgentId: ownerAgent.id, conversationId: contact.conversationId });
  res.json(stateFor(req.data, req.user, req.org));
});

app.post("/api/conversations/:conversationId/peer-messages", auth, async (req, res) => {
  const ownerAgent = ownAgents(req.data, req.org.id).find((agentItem) => agentItem.id === req.body.agentId);
  const contact = req.data.contacts.find((item) => item.ownerAgentId === ownerAgent?.id && item.conversationId === req.params.conversationId);
  const text = assertText(req.body.text, "对方 Agent 消息", { min: 1, max: 1200 });
  if (!ownerAgent || !contact) return res.status(404).json({ error: "没有找到会话" });
  const peerAgent = findAgent(req.data, contact.peerAgentId);
  req.data.messages.push({ id: id("msg"), conversationId: contact.conversationId, kind: "agent", fromAgentId: peerAgent.id, text, createdAt: now() });
  try {
    await runAgentTurn(req.data, { req, ownerAgent, contact, eventType: "peer_agent_message", text });
  } catch (err) {
    await saveData(req.data);
    if (err.status === 429) {
      await audit("ai_quota_blocked", { userId: req.user.id, organizationId: req.org.id, ownerAgentId: ownerAgent.id, conversationId: contact.conversationId });
    }
    throw err;
  }
  await saveData(req.data);
  await audit("peer_agent_message_received", { userId: req.user.id, organizationId: req.org.id, ownerAgentId: ownerAgent.id, peerAgentId: peerAgent.id, conversationId: contact.conversationId });
  res.json(stateFor(req.data, req.user, req.org));
});

app.post("/api/conversations/:conversationId/attachments", auth, async (req, res) => {
  const ownerAgent = ownAgents(req.data, req.org.id).find((agentItem) => agentItem.id === req.body.agentId);
  const contact = req.data.contacts.find((item) => item.ownerAgentId === ownerAgent?.id && item.conversationId === req.params.conversationId);
  if (!ownerAgent || !contact) return res.status(404).json({ error: "没有找到会话" });
  const upload = assertAttachmentMetadata(req.body);
  const uploadRecord = {
    id: id("upload"),
    organizationId: req.org.id,
    userId: req.user.id,
    agentId: ownerAgent.id,
    conversationId: contact.conversationId,
    kind: upload.kind,
    filename: upload.filename,
    mimeType: upload.mimeType,
    sizeBytes: upload.sizeBytes,
    createdAt: now()
  };
  req.data.fileUploads.unshift(uploadRecord);
  req.data.fileUploads = req.data.fileUploads.slice(0, 3000);
  req.data.instructions.unshift({
    id: id("ins"),
    conversationId: contact.conversationId,
    ownerAgentId: ownerAgent.id,
    text: `上传了${upload.kind}：${upload.filename}（${formatBytes(upload.sizeBytes)}），只给自己的 Agent 作为上下文。`,
    createdAt: now()
  });
  addLog(req.data, contact.conversationId, ownerAgent.id, `负责人上传${upload.kind}`, `${upload.filename} 已通过类型和大小校验，只交给自己的 Agent 理解，不直接发给对方。`);
  await saveData(req.data);
  await audit("context_attached", { userId: req.user.id, organizationId: req.org.id, ownerAgentId: ownerAgent.id, conversationId: contact.conversationId, uploadId: uploadRecord.id, kind: upload.kind, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes });
  res.json(stateFor(req.data, req.user, req.org));
});

app.post("/api/approvals/:approvalId/resolve", auth, async (req, res) => {
  const approval = req.data.approvals.find((item) => item.id === req.params.approvalId);
  if (!approval) return res.status(404).json({ error: "没有找到审批项" });
  const ownerAgent = ownAgents(req.data, req.org.id).find((agentItem) => agentItem.id === approval.ownerAgentId);
  if (!ownerAgent) return res.status(403).json({ error: "你没有权限审批这个事项" });
  const contact = req.data.contacts.find((item) => item.ownerAgentId === ownerAgent.id && item.conversationId === approval.conversationId);
  if (!contact) return res.status(404).json({ error: "没有找到会话" });
  const allowedActions = new Set(["approve", "modify", "reject", "rewrite", "supervise"]);
  approval.status = allowedActions.has(req.body.action) ? req.body.action : "approve";
  approval.resolvedAt = now();
  approval.resolvedBy = req.user.id;
  if (approval.status === "reject") {
    req.data.messages.push({ id: id("msg"), conversationId: approval.conversationId, kind: "system", fromAgentId: null, text: "负责人拒绝了这条草稿，智能员工不会对外发送。", createdAt: now() });
    addLog(req.data, approval.conversationId, ownerAgent.id, "负责人拒绝发送", approval.text);
  } else if (approval.status === "rewrite") {
    const rewriteText = assertText(req.body.text || req.body.rewriteText, "追加指令", { min: 1, max: 1200 });
    try {
      await runAgentTurn(req.data, { req, ownerAgent, contact, eventType: "rewrite_request", text: rewriteText, rewriteOfApprovalId: approval.id });
    } catch (err) {
      await saveData(req.data);
      if (err.status === 429) {
        await audit("ai_quota_blocked", { userId: req.user.id, organizationId: req.org.id, ownerAgentId: ownerAgent.id, conversationId: contact.conversationId });
      }
      throw err;
    }
    addLog(req.data, approval.conversationId, ownerAgent.id, "负责人要求重写草稿", rewriteText);
  } else if (approval.status === "supervise") {
    contact.mode = "supervised";
    addLog(req.data, approval.conversationId, ownerAgent.id, "切换会话模式", "当前会话已切换为监管模式，后续对外回复都需审批。");
  } else {
    const text = approval.status === "modify"
      ? assertText(req.body.text || req.body.modifiedText, "修改后的发送内容", { min: 1, max: 1200 })
      : approval.text;
    req.data.messages.push({
      id: id("msg"),
      conversationId: approval.conversationId,
      kind: "agent",
      fromAgentId: ownerAgent.id,
      text,
      approvalId: approval.id,
      aiEventId: approval.aiEventId || "",
      riskLevel: approval.riskLevel || riskLevelFromLabel(approval.risk),
      createdAt: now()
    });
    addLog(req.data, approval.conversationId, ownerAgent.id, approval.status === "modify" ? "负责人修改后批准发送" : "负责人批准发送", text);
  }
  await saveData(req.data);
  await audit("approval_resolved", { userId: req.user.id, organizationId: req.org.id, approvalId: approval.id, status: approval.status });
  res.json(stateFor(req.data, req.user, req.org));
});

app.post("/api/board-items/:boardItemId/resolve", auth, async (req, res) => {
  const item = (req.data.boardItems || []).find((entry) => entry.id === req.params.boardItemId);
  if (!item) return res.status(404).json({ error: "没有找到这个看板事项" });
  const ownerAgent = ownAgents(req.data, req.org.id).find((agentItem) => agentItem.id === item.ownerAgentId);
  if (!ownerAgent) return res.status(403).json({ error: "你没有权限处理这个事项" });
  item.status = "resolved";
  item.resolvedAt = now();
  item.resolvedBy = req.user.id;
  addLog(req.data, item.conversationId, ownerAgent.id, "处理看板事项", item.title);
  await saveData(req.data);
  await audit("board_item_resolved", { userId: req.user.id, organizationId: req.org.id, boardItemId: item.id, ownerAgentId: ownerAgent.id });
  res.json(stateFor(req.data, req.user, req.org));
});

app.use(express.static(distDir));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.expose ? "服务器暂时不可用" : err.message });
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`App server running at http://localhost:${port}`);
});
