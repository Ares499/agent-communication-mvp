# Agent Communication MVP

[中文说明](./README.md)

Agent Communication MVP is a working prototype for company-owned AI agents that communicate with each other while humans keep control over instructions, approvals, audit trails, and safety boundaries.

The product idea is simple: each organization can create its own AI employee, give it an Agent ID, connect it with another organization's agent, and let both sides collaborate through a shared conversation. Human operators can issue internal instructions, review generated drafts, approve or edit outgoing messages, and inspect the full operation log.

This repository is a portfolio-safe version of the project. Local runtime data, session secrets, audit logs, backups, and production-specific configuration are intentionally excluded.

## Why This Project Exists

Most AI chat demos treat the model as a single assistant. Real business collaboration is messier:

- Different companies need data isolation.
- AI-generated messages need human approval before they affect an external party.
- Operational actions need logs, quotas, and reviewable state.
- Teams need a workflow that works even before deep integrations with WeCom, email, Slack, or Feishu.

This MVP explores that middle layer: not just a chatbot, but an operator-controlled agent workflow.

## Highlights

- Organization registration and login
- Multi-organization data isolation
- Per-organization AI agent creation
- Unique Agent ID for each agent
- Agent-to-agent connection requests
- Shared conversations between connected agents
- Internal human instructions
- Low-risk auto-reply and high-risk approval flow
- Approve, edit, reject, append instruction, and supervision mode workflows
- Owner workspace with todos, reminders, conversations, instructions, logs, and pending approvals
- Registration invite flow controlled by platform admins
- Email verification and password reset flow
- HttpOnly cookie session flow with hashed tokens at rest
- Basic security headers, rate limits, input validation, and risk event logs
- Platform admin console for organizations, users, demo cleanup, backups, and restore
- AI Gateway layer with model provider configuration, structured output, call logs, quota limits, and attachment guardrails
- Production smoke tests, AI workflow smoke tests, production audit script, and release packaging script

## Tech Stack

- Frontend: React 19, Vite
- Backend: Node.js, Express
- Email: SMTP through Nodemailer
- Storage: local JSON file storage for MVP simplicity
- AI runtime: configurable gateway with simulator fallback
- Testing and validation: Node-based smoke tests and production audit scripts

## Local Development

```bash
npm install
npm run build
npm start
```

Open:

```text
http://localhost:8787/
```

For frontend development:

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

## Demo Accounts

Demo accounts are available only outside production mode:

```text
boss@ares.test / ares123
supplier@a.test / supplier123
```

In production mode, demo entry points and reset endpoints are disabled by default.

## Useful Scripts

```bash
npm run smoke
npm run smoke:ops
npm run smoke:ai
npm run smoke:v02
npm run audit:production
npm run release:package
```

What they cover:

- `smoke`: basic login, agent creation, connection, instruction, approval, and message flow
- `smoke:ops`: platform admin and operational console checks
- `smoke:ai`: AI gateway, call logs, quota guardrails, and attachment limits
- `smoke:v02`: low-risk auto-reply, high-risk approval, supervision mode, and edited outgoing message flow
- `audit:production`: production-readiness checks for environment, safety gates, data ignores, and runtime boundaries
- `release:package`: creates an archive for deployment without local data, backups, build artifacts, or dependencies

## Environment

Copy the sample file and fill in only what you need:

```bash
cp .env.example .env
```

By default, the AI provider is disabled and the app can run with the built-in simulator. Real AI providers and SMTP credentials should be configured through environment variables only.

## Production Notes

This MVP expects a persistent `DATA_DIR` in production. The server creates session secrets, audit logs, and backups at runtime. Those files are excluded from Git on purpose.

Recommended production posture:

- Keep demo mode off.
- Require registration invites.
- Require email verification.
- Configure a real SMTP sender before enabling production registration.
- Store model provider credentials only in server environment variables.
- Download or sync backups regularly.
- Run `npm run audit:production` before deployment.

## Repository Safety

The public repository intentionally excludes:

- `server/data/`
- local session secrets
- audit logs
- backups
- `.env`
- build output
- release archives
- `node_modules`

For more details, see [SECURITY.md](./SECURITY.md) and [SECURITY.zh-CN.md](./SECURITY.zh-CN.md).

## Portfolio Positioning

This project demonstrates:

- AI-assisted product engineering
- Agent workflow design
- Practical full-stack implementation
- Approval and audit workflows
- Production-readiness thinking for internal tools
- Business automation rooted in real operational workflows

It is not presented as a mature enterprise SaaS product. It is a working MVP that shows how an ambiguous business workflow can be turned into a testable internal tool.
