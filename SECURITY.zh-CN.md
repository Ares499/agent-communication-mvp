# 安全说明

这个仓库是作品集安全版本，用来展示 AI Agent 工作流、产品工程能力和生产安全意识，不公开运行密钥、真实业务数据或生产配置。

## 绝对不能提交的内容

- `.env` 文件
- SMTP 密码
- AI 模型供应商 API Key
- 会话密钥
- 审计日志
- 备份文件
- `server/data/`
- 客户、供应商或真实组织数据
- 真实部署凭证

## 当前公开边界

公开仓库只保留源代码、文档、示例环境变量名称和测试脚本。

以下运行文件已被 `.gitignore` 忽略：

- `server/data/`
- `.env`
- `.release/`
- `dist/`
- `node_modules/`
- `*.secret`
- `*.sqlite`
- `*.sqlite3`
- `audit.jsonl`
- `backups/`

## 发布或更新前检查

运行：

```bash
git status --short --ignored
git ls-files
npm run audit:production
```

再扫描是否误放密钥：

```bash
rg -n "agentim\\.com\\.cn|20470180|OPENAI_API_KEY=.+[^[:space:]]|AI_API_KEY=.+[^[:space:]]|SMTP_PASS=.+[^[:space:]]|sk-[A-Za-z0-9_-]{20,}" .
```

`process.env.AI_API_KEY` 这种变量名是正常的；真正的密钥值不能出现。

## 对线上服务器是否有风险

单纯把这个仓库放到 GitHub，不会自动暴露线上服务器后台。真正危险的是把真实 `.env`、真实数据、后台初始化密码、SMTP 密码、AI API Key、会话密钥或生产域名配置提交上去。

生产部署建议：

- 保持 `NODE_ENV=production`
- 保持 `ALLOW_DEMO=false`
- 注册必须使用邀请码
- 注册必须邮箱验证
- 管理员初始化密码只放服务器环境变量
- SMTP 密码只放服务器环境变量
- AI API Key 只放服务器环境变量
- 使用私有持久化 `DATA_DIR`
- 单独备份 `DATA_DIR/backups`
