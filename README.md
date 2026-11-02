# Swarn Sathi – Branch Console API

Backend for a gold loan branch: magic-code login, customers, gold appraisal, loan sanction and approval, repayments, closure with gold release, and an audit trail. Built with Bun, Express 5, TypeScript, Zod, Prisma and PostgreSQL. Redis backs rate limiting and the gold rate cache. Mailpit catches development email.

## Prerequisites

Docker (with Compose) and Git. Nothing else.

## Run

```bash
git clone <repo-url> && cd mudra0
docker compose up --build
```

This starts Postgres, Redis, Mailpit and the API. The API container applies migrations, loads seed data (only on an empty database), then serves:

| What | URL |
|---|---|
| API | http://localhost:3000 |
| API docs (Swagger UI) | http://localhost:3000/docs (raw spec: `/openapi.json`, source: `docs/openapi.yaml`) |
| Sign-in emails (Mailpit) | http://localhost:8025 |

## Sign in

1. `POST /auth/request-code` with `{"email": "staff.kolkata@swarnsathi.test"}`
2. Open Mailpit at http://localhost:8025 and read the 6-digit code. Without SMTP configured, the code is printed to the API console instead.
3. `POST /auth/verify` with `{"email": "...", "code": "123456"}` returns a `token`. Send it as `Authorization: Bearer <token>`.

Seeded logins (all data is fictional):

| Role | Email | Branch |
|---|---|---|
| Admin | admin@swarnsathi.test | – |
| Branch manager | manager.kolkata@swarnsathi.test | KOL01 |
| Branch staff | staff.kolkata@swarnsathi.test | KOL01 |
| Branch manager | manager.howrah@swarnsathi.test | HWH01 |
| Branch staff | staff.howrah@swarnsathi.test | HWH01 |

The seed also creates a 7-day gold rate history, five customers and loans in each state: active with payments, overdue, closed with gold released, and one ₹3,50,000 loan waiting in the Kolkata approvals queue.

## Tests

```bash
docker compose run --rm api bun test
```

Tests run against a separate `swarn_test` database, which is migrated automatically before the run. `tests/unit` covers the money rules (interest, allocation, LTV slabs, fees). `tests/integration` drives the HTTP API: magic code rules, a role × endpoint permission matrix, branch isolation, the loan lifecycle, concurrent approvals and payments, and immutability of the audit trail.

## Run without Docker

Needs Bun 1.2+, Postgres 16 and optionally Redis.

```bash
bun install && cp .env.example .env   # edit DATABASE_URL etc.
bun run db:migrate && bun run db:seed
bun run dev        # or: bun test, bun run typecheck
```

## Code map

```
src/
  app.ts, server.ts      Express app wiring and entry point
  config/env.ts          Validated environment
  domain/                Pure business rules, no I/O: money, dates, gold valuation,
                         LTV slabs and pricing, interest replay and payment allocation
  lib/                   Prisma client and row lock, Redis cache, mailer, audit writer,
                         clock (IST "today"), errors, pagination, validation helpers
  middleware/            Authentication, role checks, rate limits, error handler
  modules/<name>/        One folder per feature: *.routes.ts (HTTP + Zod) and *.service.ts (logic)
    auth users customers gold-rates appraisals loans payments audit docs
prisma/
  schema.prisma          Data model
  migrations/            Versioned SQL, including CHECK constraints, a partial unique
                         index and triggers that make audit, appraisal and payment rows immutable
  seed.ts                Demo data, created through the same services the API uses
tests/unit, tests/integration
docs/openapi.yaml        API documentation
```

See `DECISIONS.md` for assumptions and trade-offs, and `AI_USAGE.md` for how AI tools were used.
