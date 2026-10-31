# AI usage

> **Candidate: review and finish this file before submitting.** The sections below describe what actually happened in the AI session. The "written by hand" section can only be filled in by you.

## Tools

- **Kiro (agent mode, Claude model)** in a browser sandbox. I used it to turn the brief into a plan, then to generate the Prisma schema and SQL constraints, the domain logic, the Express modules, the tests, the seed data, the OpenAPI spec and drafts of these documents. The agent ran the tests and typecheck itself against a local Postgres.

## Prompts that worked well

1. *"Let's plan this spec… stick to Node stack: Express, TypeScript, Zod, Prisma, SMTP, Bun… keep the code structured, module based architecture, cleaner, no heavy comments."* + the full brief. This produced a plan that flagged the open decisions (frontend gap, runtime, renewal semantics, branch strategy) before any code was written.
2. *"Runtime in Bun, SMTP with nodemailer, your proposal works but make sure things don't get over complicated as I have to update the code later and explain in the interview, raise PR in 2 parts (tier 1 and tier 2), express rate limit, Redis for repetitive calls, docker compose."* Constraining the scope here kept the design simple: a single replay function for balances, and row locks instead of optimistic versioning.
3. Asking for tests that state the money arithmetic explicitly (for example, ₹1,00,000 at 18% for 30 days = 1,47,945.205 paise, rounded to 1,47,945) rather than tests that only re-run the code.

## Where the AI was wrong or incomplete

1. **`bun add` broke on a `postinstall` hook.** The first `package.json` ran `prisma generate` on postinstall before a schema existed, so the install failed and the dependencies were not saved. This showed up as a failing install. The hook was replaced with an explicit `db:generate` script.
2. **Tests for the immutability triggers passed a PrismaPromise to `expect(...).rejects`.** Bun's matcher needs a native Promise, so the test failed even though the trigger worked. The failure output said "Expected promise". The fix was `Promise.resolve(...)`.
3. **A test called `JSON.stringify` on an audit row** whose `id` is a `BigInt`, and it threw. It now checks only the `after` JSON.
4. **Prisma CLI in the Bun Docker image.** The `prisma` bin has a `node` shebang and the Bun image has no Node, so the scripts were changed to `bunx --bun prisma`. This was caught in review, not by a failing run, because Docker was unavailable in the sandbox. See the gaps listed in DECISIONS.md.

5. **Shared state between test groups.** The first Tier 2 test file reset the database in several `describe`-level `beforeAll` hooks. One group's lowered gold rate leaked into others, and loans failed with `LTV_EXCEEDED` at the wrong rate. The fix was one test file per feature, each with a single reset at the top.
6. **A hand-computed expectation was wrong.** The receipt test expected ₹99,520.55 outstanding after a ₹2,000 payment, but ₹520.55 is the *principal paid*, so outstanding is ₹1,00,000 − ₹520.55 = ₹99,479.45. The code was right and the test was wrong, which was a reminder to derive expected values on paper.

## What I wrote or rewrote by hand, and why

_TODO (candidate): list the parts you changed yourself after reading the code, for example rules you re-derived, tests you added, naming you changed, and why._
