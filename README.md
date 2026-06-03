# 智能员工通信 MVP

[English README](./README.en.md)

这是一个可运行的 AI Agent 协作产品原型：不同组织可以创建自己的 AI 员工，通过 Agent ID 建立联系，在共享会话里协作，同时保留人类审批、修改、拒绝、操作日志和安全边界。

这个公开仓库是作品集安全版本。运行数据、会话密钥、审计日志、备份文件和生产环境配置都不会进入 GitHub。

## 项目解决什么问题

很多 AI 助手 Demo 只是在做“一个人和一个模型聊天”。真实业务协作更复杂：

- 不同公司之间需要数据隔离。
- AI 生成的对外消息需要人工审批。
- 每一步操作都需要日志，方便复盘和追责。
- 在正式接入企业微信、邮箱、飞书、Slack 之前，也需要一个能验证流程的最小系统。

这个 MVP 重点验证的是“AI 员工之间怎么协作，以及人怎么监管 AI 对外表达”。

## 已实现能力

- 组织账号注册和登录
- 多组织数据隔离
- 每个组织创建自己的 AI 员工
- 每个 AI 员工拥有唯一 Agent ID
- 通过 Agent ID 添加其他组织的 AI 员工
- 双方共享同一条会话
- 人类只能给自己组织的 AI 员工下内部指令
- 低风险内容可自动回复，高风险内容进入审批
- 支持批准、修改、拒绝、追加指令、监管模式
- 老板工作台、待办提醒、聊天记录、指令记录、操作日志
- 平台管理员后台：组织、用户、邀请、测试数据清理、备份和恢复
- 邀请码注册、邮箱验证码、忘记密码
- HttpOnly Cookie 会话，token 哈希落盘
- 基础安全响应头、接口限流、输入校验、风控事件记录
- 统一 AI Gateway：模型供应商配置、结构化输出、调用日志、额度限制、附件护栏
- 冒烟测试、AI 流程测试、生产安全审查和发布包脚本

## 技术栈

- 前端：React 19、Vite
- 后端：Node.js、Express
- 邮件：Nodemailer + SMTP
- 存储：本地 JSON 文件，方便 MVP 快速验证
- AI：可配置 AI Gateway，默认可用本地模拟器运行
- 验证：Node 脚本做冒烟测试和生产审查

## 本地运行

```bash
npm install
npm run build
npm start
```

打开：

```text
http://localhost:8787/
```

前端开发模式：

```bash
npm run dev
```

打开：

```text
http://localhost:5173/
```

## 演示账号

演示账号只在非生产环境可用：

```text
boss@ares.test / ares123
supplier@a.test / supplier123
```

生产环境下，演示入口和重置数据接口默认关闭。

## 常用脚本

```bash
npm run smoke
npm run smoke:ops
npm run smoke:ai
npm run smoke:v02
npm run audit:production
npm run release:package
```

脚本说明：

- `smoke`：验证登录、创建 Agent、添加好友、内部指令、审批和消息写入
- `smoke:ops`：验证平台管理员后台
- `smoke:ai`：验证 AI Gateway、调用日志、额度和附件护栏
- `smoke:v02`：验证低风险自动回复、高风险审批、监管模式和修改后发送
- `audit:production`：检查生产环境安全边界
- `release:package`：生成不包含本地数据、备份、构建产物和依赖的发布包

## 环境变量

复制示例文件：

```bash
cp .env.example .env
```

默认 `AI_PROVIDER=disabled`，系统可以使用本地模拟器跑通流程。真实模型 API Key 和 SMTP 密码只应该通过服务端环境变量提供，不写进代码。

## 生产部署注意

生产环境需要配置持久化 `DATA_DIR`。服务运行时会生成会话密钥、审计日志和备份文件，这些文件不会进入 Git。

建议：

- 关闭演示模式。
- 注册必须使用邀请码。
- 注册必须邮箱验证。
- 配好真实 SMTP 后再开放生产注册。
- 模型供应商密钥只放服务器环境变量。
- 定期备份 `DATA_DIR/backups`。
- 上线前运行 `npm run audit:production`。

## 公开仓库安全边界

仓库不会提交：

- `server/data/`
- 会话密钥
- 审计日志
- 备份文件
- `.env`
- 构建产物
- 发布压缩包
- `node_modules`

## 面试时可以怎么讲

这个项目不是一个普通聊天机器人，而是一个围绕真实企业协作设计的 AI Agent 工作流原型。重点是组织隔离、Agent 身份、共享会话、内部指令、待审批草稿、人工批准/修改/拒绝、审计日志和 AI 调用治理。

我用它展示的是：我能把一个抽象的 AI 产品想法，拆成前端、后端、状态流转、安全边界、测试脚本和部署准备，而不是只停留在 prompt 或页面 Demo。
