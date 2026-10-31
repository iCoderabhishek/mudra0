-- Value checks enforced by the database, not only by the API.
ALTER TABLE "Customer"
  ADD CONSTRAINT customer_pan_format CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  ADD CONSTRAINT customer_aadhaar_last4 CHECK ("aadhaarLast4" ~ '^[0-9]{4}$'),
  ADD CONSTRAINT customer_phone_format CHECK (phone ~ '^[6-9][0-9]{9}$');

ALTER TABLE "User"
  ADD CONSTRAINT user_branch_by_role CHECK (role = 'ADMIN' OR "branchId" IS NOT NULL);

ALTER TABLE "GoldRate"
  ADD CONSTRAINT gold_rate_positive CHECK ("ratePaisePerGram" > 0);

ALTER TABLE "AppraisalItem"
  ADD CONSTRAINT item_karat_allowed CHECK (karat IN (18, 20, 22, 24)),
  ADD CONSTRAINT item_weights_valid CHECK ("stoneWeightMg" >= 0 AND "stoneWeightMg" < "grossWeightMg"),
  ADD CONSTRAINT item_net_weight CHECK ("netWeightMg" = "grossWeightMg" - "stoneWeightMg"),
  ADD CONSTRAINT item_value_non_negative CHECK ("valuePaise" >= 0);

ALTER TABLE "Appraisal"
  ADD CONSTRAINT appraisal_amounts_valid CHECK ("appraisedValuePaise" >= 0 AND "maxLoanPaise" >= 0 AND "maxLoanPaise" <= "appraisedValuePaise");

ALTER TABLE "Loan"
  ADD CONSTRAINT loan_principal_positive CHECK ("principalPaise" > 0),
  ADD CONSTRAINT loan_outstanding_range CHECK ("outstandingPrincipalPaise" >= 0 AND "outstandingPrincipalPaise" <= "principalPaise"),
  ADD CONSTRAINT loan_disbursal_math CHECK ("netDisbursalPaise" = "principalPaise" - "processingFeePaise" - "renewalPayoffPaise" AND "netDisbursalPaise" >= 0),
  ADD CONSTRAINT loan_scheme_tenure CHECK (
    (scheme = 'STANDARD' AND "tenureMonths" BETWEEN 3 AND 12) OR
    (scheme = 'QUICK' AND "tenureMonths" BETWEEN 1 AND 3)
  ),
  ADD CONSTRAINT loan_active_has_dates CHECK (status IN ('PENDING_APPROVAL', 'REJECTED') OR ("disbursedOn" IS NOT NULL AND "maturityDate" IS NOT NULL)),
  ADD CONSTRAINT loan_closed_is_settled CHECK (status <> 'CLOSED' OR "outstandingPrincipalPaise" = 0),
  ADD CONSTRAINT loan_approver_not_creator CHECK ("approvedById" IS NULL OR "approvedById" <> "createdById");

ALTER TABLE "Payment"
  ADD CONSTRAINT payment_amount_positive CHECK ("amountPaise" > 0),
  ADD CONSTRAINT payment_split CHECK ("interestPaidPaise" >= 0 AND "principalPaidPaise" >= 0 AND "amountPaise" = "interestPaidPaise" + "principalPaidPaise");

-- One appraisal (one set of pledged gold) backs at most one non-rejected loan.
CREATE UNIQUE INDEX loan_one_per_appraisal ON "Loan" ("appraisalId") WHERE status <> 'REJECTED';

-- Fast case-insensitive substring search on customer name.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX customer_name_trgm ON "Customer" USING gin (name gin_trgm_ops);

-- Snapshots and ledgers are append-only.
CREATE OR REPLACE FUNCTION reject_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER appraisal_immutable BEFORE UPDATE OR DELETE ON "Appraisal"
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER appraisal_item_immutable BEFORE UPDATE OR DELETE ON "AppraisalItem"
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER gold_rate_immutable BEFORE UPDATE OR DELETE ON "GoldRate"
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
