# Security Notes

This repository is a portfolio-safe MVP. It is intended to show product engineering, agent workflow design, and production-readiness thinking without publishing runtime secrets or business data.

## What Must Never Be Committed

- `.env` files
- SMTP passwords
- AI provider API keys
- session secrets
- audit logs
- backups
- `server/data/`
- customer, supplier, or production organization data
- real deployment credentials

## Current Repository Boundary

The public repository keeps only source code, documentation, sample environment variable names, and test scripts.

Runtime files are ignored by `.gitignore`, including:

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

## Before Publishing or Updating

Run:

```bash
git status --short --ignored
git ls-files
npm run audit:production
```

Also scan for accidental secrets:

```bash
rg -n "agentim\\.com\\.cn|20470180|OPENAI_API_KEY=.+[^[:space:]]|AI_API_KEY=.+[^[:space:]]|SMTP_PASS=.+[^[:space:]]|sk-[A-Za-z0-9_-]{20,}" .
```

Matches such as `process.env.AI_API_KEY` are expected. Actual secret values are not.

## Production Safety

Publishing this repository does not expose a running server by itself. A production deployment is only at risk if real environment variables, data files, credentials, or admin bootstrap passwords are exposed.

For production deployments:

- keep `NODE_ENV=production`
- keep `ALLOW_DEMO=false`
- require registration invites
- require email verification
- set strong admin bootstrap credentials only in the server environment
- configure SMTP credentials only in the server environment
- configure AI provider keys only in the server environment
- use a private persistent `DATA_DIR`
- back up `DATA_DIR/backups` separately
