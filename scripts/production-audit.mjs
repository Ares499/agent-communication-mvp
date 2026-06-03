import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];

function pass(name, detail = "") {
  checks.push({ ok: true, name, detail });
}

function fail(name, detail = "") {
  checks.push({ ok: false, name, detail });
}

async function read(relativePath) {
  return readFile(path.join(rootDir, relativePath), "utf8");
}

const server = await read("server/server.mjs");
const app = await read("src/App.jsx");
const api = await read("src/lib/api.js");
const envExample = await read(".env.example");
const releasePackage = await read("scripts/release-package.mjs");
const gitignore = await read(".gitignore");

if (server.includes("ALLOW_DEMO === \"true\"") && server.includes("!isProduction")) {
  pass("生产环境默认关闭演示账号和重置接口");
} else {
  fail("生产环境默认关闭演示账号和重置接口");
}

if (server.includes("tokenHash") && server.includes("createHmac")) {
  pass("会话 token 以哈希形式落盘");
} else {
  fail("会话 token 以哈希形式落盘");
}

if (server.includes("httpOnly: true") && server.includes("sameSite: \"lax\"") && server.includes("agent_comm_session")) {
  pass("浏览器会话使用 HttpOnly Cookie");
} else {
  fail("浏览器会话使用 HttpOnly Cookie");
}

if (server.includes("expiresAt") && server.includes("SESSION_TTL_HOURS")) {
  pass("登录会话存在有效期");
} else {
  fail("登录会话存在有效期");
}

if (server.includes("Content-Security-Policy") && server.includes("X-Frame-Options")) {
  pass("基础安全响应头已启用");
} else {
  fail("基础安全响应头已启用");
}

if (server.includes("rateLimit") && server.includes("请求太频繁")) {
  pass("接口限流已启用");
} else {
  fail("接口限流已启用");
}

if (server.includes("backupDataIfNeeded") && server.includes("rename(tmpFile, dataFile)")) {
  pass("数据原子写入和定时备份已启用");
} else {
  fail("数据原子写入和定时备份已启用");
}

if (server.includes("audit.jsonl") && server.includes("audit(\"")) {
  pass("关键业务动作写入审计日志");
} else {
  fail("关键业务动作写入审计日志");
}

if (server.includes("emailVerifications") && server.includes("/api/auth/email-code") && server.includes("codeHash")) {
  pass("注册邮箱验证码已启用且验证码不明文落盘");
} else {
  fail("注册邮箱验证码已启用且验证码不明文落盘");
}

if (server.includes("registrationInvites") && server.includes("/api/registration-invites") && server.includes("registrationInviteRequired") && server.includes("isProduction || process.env.REGISTRATION_INVITE_REQUIRED !== \"false\"")) {
  pass("注册邀请码机制已启用");
} else {
  fail("注册邀请码机制已启用");
}

if (server.includes("assertPlatformAdmin(req, res)") && server.includes("const maxUses = 1;") && app.includes("每个邀请码只能使用一次")) {
  pass("注册邀请仅平台管理员可生成且强制单次使用");
} else {
  fail("注册邀请仅平台管理员可生成且强制单次使用");
}

if (server.includes("SMTP_HOST") && server.includes("nodemailer") && server.includes("邮件服务还没有配置")) {
  pass("生产邮件发送依赖显式 SMTP 配置");
} else {
  fail("生产邮件发送依赖显式 SMTP 配置");
}

if (server.includes("/api/auth/password-reset-code") && server.includes("/api/auth/reset-password") && server.includes("password_reset_completed")) {
  pass("忘记密码使用邮箱验证码并清退旧会话");
} else {
  fail("忘记密码使用邮箱验证码并清退旧会话");
}

if (server.includes("riskEvents") && server.includes("assertLoginRiskAllowed") && server.includes("验证码次数过多")) {
  pass("基础风控覆盖登录失败和验证码滥用");
} else {
  fail("基础风控覆盖登录失败和验证码滥用");
}

if (server.includes("ADMIN_EMAILS") && server.includes("/api/admin/overview") && server.includes("assertPlatformAdmin")) {
  pass("平台管理员后台接口启用独立权限");
} else {
  fail("平台管理员后台接口启用独立权限");
}

if (server.includes("BOOTSTRAP_ADMIN_EMAIL") && server.includes("ensureBootstrapAdmin") && server.includes("BOOTSTRAP_ADMIN_RESET_PASSWORD")) {
  pass("首次上线支持初始化平台管理员账号");
} else {
  fail("首次上线支持初始化平台管理员账号");
}

if (server.includes("/api/admin/cleanup-test-data") && server.includes("cleanupTestData") && server.includes("before-cleanup")) {
  pass("测试账号和测试邀请可在备份后清理");
} else {
  fail("测试账号和测试邀请可在备份后清理");
}

if (server.includes("/api/admin/backups") && server.includes("admin_backup_restored") && server.includes("before-restore")) {
  pass("管理员可创建和恢复数据备份");
} else {
  fail("管理员可创建和恢复数据备份");
}

if (app.includes("state.featureFlags?.allowDemo") && app.includes("api.config()")) {
  pass("前端按服务端开关隐藏演示能力");
} else {
  fail("前端按服务端开关隐藏演示能力");
}

if (app.includes("drawer === \"admin\"") && app.includes("忘记密码") && api.includes("adminOverview") && api.includes("resetPassword")) {
  pass("前端暴露运营后台和忘记密码入口");
} else {
  fail("前端暴露运营后台和忘记密码入口");
}

if (envExample.includes("ALLOW_DEMO=false") && envExample.includes("SESSION_TTL_HOURS") && envExample.includes("COOKIE_SECURE") && envExample.includes("SMTP_HOST") && envExample.includes("REGISTRATION_INVITE_REQUIRED=true") && envExample.includes("ADMIN_EMAILS") && envExample.includes("BOOTSTRAP_ADMIN_EMAIL") && envExample.includes("BACKUP_DIR")) {
  pass("环境变量样例包含生产安全开关");
} else {
  fail("环境变量样例包含生产安全开关");
}

if (server.includes("process.env.AI_API_KEY") && server.includes("aiApiKeyConfigured") && !app.includes("AI_API_KEY")) {
  pass("AI API Key 只从服务端环境变量读取且不暴露到前端");
} else {
  fail("AI API Key 只从服务端环境变量读取且不暴露到前端");
}

if (server.includes("aiUsageEvents") && server.includes("recordAiUsage") && server.includes("Agent 调用记录") && app.includes("Agent 调用日志")) {
  pass("Agent 调用日志已写入服务端并在运营后台可见");
} else {
  fail("Agent 调用日志已写入服务端并在运营后台可见");
}

if (server.includes("generateAgentTurn") && server.includes("callRealProvider") && server.includes("response_format") && server.includes("AI_BASE_URL")) {
  pass("v0.2 AI Gateway 通过统一 provider 接口接入真实模型");
} else {
  fail("v0.2 AI Gateway 通过统一 provider 接口接入真实模型");
}

if (server.includes("validateAgentModelResult") && server.includes("send_auto") && server.includes("require_approval") && server.includes("ask_human") && server.includes("no_reply")) {
  pass("v0.2 模型输出使用结构化 schema 校验");
} else {
  fail("v0.2 模型输出使用结构化 schema 校验");
}

if (server.includes("applySystemGuards") && server.includes("must_approve_business_commitment") && server.includes("blocked_sensitive_content")) {
  pass("v0.2 系统规则覆盖模型判断");
} else {
  fail("v0.2 系统规则覆盖模型判断");
}

if (server.includes("/api/conversations/:conversationId/mode") && server.includes("conversation_mode_updated") && app.includes("监管模式")) {
  pass("v0.2 会话级自动/监管模式可切换并审计");
} else {
  fail("v0.2 会话级自动/监管模式可切换并审计");
}

if (server.includes("boardItems") && server.includes("addBoardItem") && app.includes("看板提醒")) {
  pass("v0.2 看板提醒覆盖模型失败、缺资料和人工确认");
} else {
  fail("v0.2 看板提醒覆盖模型失败、缺资料和人工确认");
}

if (server.includes("ruleOverrides") && server.includes("latencyMs") && server.includes("errorType") && !server.includes("promptText")) {
  pass("v0.2 AI 日志记录风险、规则覆盖、耗时和错误类型且不默认落完整 prompt");
} else {
  fail("v0.2 AI 日志记录风险、规则覆盖、耗时和错误类型且不默认落完整 prompt");
}

if (server.includes("AI_ORG_DAILY_LIMIT") && server.includes("AI_USER_DAILY_LIMIT") && server.includes("assertAiQuota") && server.includes("blocked_quota")) {
  pass("组织和用户级 Agent 日额度已启用");
} else {
  fail("组织和用户级 Agent 日额度已启用");
}

if (server.includes("ATTACHMENT_MAX_BYTES") && server.includes("ATTACHMENT_ALLOWED_TYPES") && server.includes("assertAttachmentMetadata") && server.includes("fileUploads") && api.includes("attachContext")) {
  pass("上下文文件上传已限制大小和 MIME 类型");
} else {
  fail("上下文文件上传已限制大小和 MIME 类型");
}

if (envExample.includes("AI_PROVIDER=disabled") && envExample.includes("AI_API_KEY=") && envExample.includes("ATTACHMENT_MAX_BYTES") && envExample.includes("ATTACHMENT_ALLOWED_TYPES")) {
  pass("环境变量样例包含 AI 和上传护栏配置");
} else {
  fail("环境变量样例包含 AI 和上传护栏配置");
}

if (releasePackage.includes("agent-communication-v${version}") && releasePackage.includes("version = \"0.2.0\"") && releasePackage.includes("git") && releasePackage.includes(".release") && releasePackage.includes("--exclude=.env")) {
  pass("发布包脚本记录版本、分支和提交号");
} else {
  fail("发布包脚本记录版本、分支和提交号");
}

if (gitignore.includes(".env") && gitignore.includes("server/data/") && gitignore.includes(".release/") && gitignore.includes("node_modules/")) {
  pass("版本记录默认忽略密钥、运行数据和发布包");
} else {
  fail("版本记录默认忽略密钥、运行数据和发布包");
}

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

if (failed.length) {
  console.error(`\nProduction audit failed: ${failed.length} issue(s).`);
  process.exit(1);
}

console.log("\nProduction audit passed.");
