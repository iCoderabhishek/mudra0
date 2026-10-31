# Decisions

## Assumptions where the brief was silent

- **Interest days.** Interest starts on the disbursal date. The disbursal day itself accrues nothing, and each later calendar day (IST) accrues one day. A loan repaid on the day it was disbursed owes no interest.
- **Payment date** is always "today" in IST. Back-dated payments are not supported, so history cannot be rewritten.
- **Disbursal date.** Loans up to ₹3,00,000 are disbursed when they are created. Larger loans are disbursed on the approval date, and interest and maturity count from then.
- **Approval threshold** is strictly above ₹3,00,000, so exactly ₹3,00,000 needs no approval. A manager cannot approve or reject a loan they created. This is checked in code and by a DB check constraint.
- **Tenure.** Standard is 3 to 12 months. Quick is 1 to 3 months. Maturity is the disbursal date plus the tenure in calendar months, clamped to the month end (31 Jan + 1 month = 28 Feb). A loan is overdue from the day after maturity while anything is owed.
- **Minimum principal** is ₹5,000, so the ₹500 minimum fee cannot exceed the loan.
- **Maximum loan** shown on an appraisal is the largest principal that fits its own slab's cap. Because slabs are chosen by principal, this is not simply a percentage of the value: ₹2,60,000 of gold allows ₹2,00,000 at 80%, while 75% would give only ₹1,95,000.
- **One appraisal backs one loan.** A partial unique index allows a new loan on the same appraisal only if the previous one was rejected. Appraisals do not expire. In practice they probably should be valid for the same day only.
- **Closure is explicit.** A fully paid loan stays ACTIVE (not overdue) until a staff member or manager closes it, because closing is the moment the gold is handed back. Closure records who released the gold, when, and a snapshot of the items.
- **Customers** belong to the branch that created them. PAN is unique across the company. Customers must be 18 or older and have a 10-digit Indian mobile number.
- **Admin** manages users and gold rates, sees all-branch reports, and can read the full audit log. Admin cannot read customer KYC or loans. Managers see everything in their own branch only. A record in another branch returns 404 rather than 403, so its existence is not revealed.
- **Login.** Requesting a new code invalidates any earlier unused code. Rate limits: 3 code requests per email and 20 per IP per 15 minutes, 30 verify attempts per IP per 15 minutes, and 300 API calls per IP per minute. The request endpoint always answers 202, so it does not reveal which emails exist.

- **Gold rate.** Rates are append-only and the latest row wins. A rate is effective from "today", and setting several in one day is allowed. Pending loans are not re-checked against the rate when they are approved.
- **LTV breach.** A loan breaches when its outstanding principal is above the cap of the slab it was sanctioned under, measured against the pledged items re-valued at today's rate (with the same per-item rounding as an appraisal). Accrued interest is not included.
- **Dashboard and CSV** are both built from one function that returns a row per disbursed loan (`reports/portfolio.service.ts`), and one `summarize()` produces the totals, so they cannot drift apart. The CSV covers loans *disbursed* in `[from, to]`, both active and closed. The dashboard takes the same optional range.
  - "Interest accrued today" is one day of interest on each active loan disbursed before today. It is an indicator: because interest is rounded per segment, the sum of daily figures can differ from the interest actually charged by a few paise.
  - "Overdue amount" is the total due, principal plus interest.
- **Renewal** takes one transaction:
  1. Record a payment of the old loan's full total due (mode `RENEWAL`) and close the old loan.
  2. Re-appraise the same items at today's rate.
  3. Open the new loan, where net disbursal = principal − fee − payoff.

  No gold release is recorded, because the gold stays pledged. Renewals above ₹3,00,000 are rejected rather than parked for approval, to avoid a half-renewed state. Any rule failure rolls back the whole renewal.
- **Statement and receipt** are server-rendered HTML with print CSS, not PDF. They need the bearer header, so they are opened through an API client or a future frontend.

## Main design choices

- **Money** is integer paise (`BIGINT` in Postgres, `bigint` in TypeScript). There is no floating point anywhere. **Rounding rule:** round half-up to the paisa in three places: each item's value, each interest segment, and the processing fee. Maximum loan rounds down, so the cap is never exceeded. LTV checks compare `principal × 10000 ≤ value × capBps` exactly, with no rounding. The API returns money as digit strings. Weights are integer milligrams.
- **Balances are computed by replaying payments** (`domain/interest.ts`). Interest accrues in segments between payments, and each segment is rounded once. The due calculator therefore gives the same answer for a past date as was charged at the time, and the same function is used for payments, closure and display. `Loan.outstandingPrincipalPaise` is a denormalised copy, updated under the row lock, so list and report queries don't need to replay.
- **Concurrency.** Every state change on a loan (approve, reject, pay, close) runs in a transaction that starts with `SELECT … FOR UPDATE` on the loan row. Tests fire two approvals, five duplicate payments, and two payments that would overpay together at the same time, and check that balances stay correct.
- **Duplicate payments.** `POST /loans/:id/payments` requires an `Idempotency-Key` header, enforced by `UNIQUE(loanId, idempotencyKey)`. A retry with the same key returns the original payment. The same key with a different amount returns 409.
- **The database enforces the rules that matter:** CHECK constraints for karat, weights, PAN format, the payment split summing to the amount, tenure per scheme, disbursal maths and the approver ≠ creator rule. Triggers reject UPDATE and DELETE on `AuditLog`, `Appraisal`, `AppraisalItem`, `Payment` and `GoldRate`. A trigram index supports customer name search.
- **Auth.** Codes and session tokens are stored only as HMAC-SHA256 hashes. The attempt counter is incremented atomically before the code is compared, so parallel guesses cannot exceed 5. Sessions are opaque bearer tokens with a 12-hour expiry, and deactivating a user or changing their role deletes their sessions.
- **Redis** holds the rate limit counters, so limits work across API instances, and caches the current gold rate for 5 minutes. The cache entry is dropped when a new rate is set. If Redis is unavailable, the app falls back to in-process limits and reads the rate from the database.
- **Structure.** `domain/` holds pure functions with unit tests. Each `modules/<x>` has a routes file (HTTP and Zod parsing) and a service file (transactions and rules). Errors share one shape, `{ error: { code, message, details? } }`. Zod, Prisma unique-constraint and JSON parse errors are mapped to that shape. Anything unexpected is logged on the server and returned as a generic 500 with no stack trace.
- **Pagination** uses a cursor on `(createdAt, id)` and is capped at 100 rows. Indexes cover the list filters, sized for about 200k loans: `(branchId, status, createdAt)`, `(status, maturityDate)`, `customerId` and `(loanId, createdAt)` on payments.

## Deliberately left out

- **Frontend (Tier 1 item 9).** No screens were built. The API, Swagger UI and seed data are the way to use it. This was a conscious time trade-off in favour of correct and tested backend rules.
- Tier 3: nightly accrual job, customer self-service view, payment reversal, deployment. CI (typecheck, tests, Docker build) is included and passing.
- Real email, SMS, KYC and payment gateways. Email goes to Mailpit or the console. There is no KYC check beyond format validation.

## Known gaps and risks

- `docker compose up` itself was **not run end to end** while building, because the build sandbox had no working Docker. GitHub Actions does build the Docker image and runs the full test suite against a fresh Postgres 16. Migrations, seed and the server were also run locally with the same commands the container runs. The Redis-backed code paths (rate limit store, rate cache) are not covered by the automated tests, which use the in-process fallback.
- Date-only fields (`disbursedOn`, `maturityDate`, `dateOfBirth`) are serialised as ISO timestamps at midnight UTC (`2026-10-31T00:00:00.000Z`). Clients should read only the date part.
- Per-IP limits depend on `TRUST_PROXY` being set correctly behind a load balancer.
- **Report scale.** The portfolio function loads every disbursed loan in scope into memory. That is fine for one branch, but an admin all-branch dashboard at 200k loans would be slow. The fix is to aggregate in SQL or to read from a nightly snapshot, which is what the Tier 3 accrual job would produce.
- Rejection stores the deciding manager in `approvedById`. The column name is misleading for rejections.
- The audit log is append-only at the application and trigger level, but a database superuser can still disable the triggers. A hash chain or an external log sink would make tampering detectable.
- The request-code endpoint takes slightly longer for known emails, because it sends mail. That timing could leak which emails exist.

## With one more week

A minimal clerk frontend, the nightly accrual and overdue job, a payment reversal flow that keeps the audit trail, same-day validity for appraisals, a hash-chained audit log, CI with deployment, and load tests at 200k loans to check query plans.
