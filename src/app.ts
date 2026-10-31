import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { authenticate } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { createLimiters } from "./middleware/rate-limit";
import { appraisalsRouter } from "./modules/appraisals/appraisals.routes";
import { auditRouter } from "./modules/audit/audit.routes";
import { createAuthRouter } from "./modules/auth/auth.routes";
import { customersRouter } from "./modules/customers/customers.routes";
import { docsRouter } from "./modules/docs/docs.routes";
import { goldRatesRouter } from "./modules/gold-rates/gold-rates.routes";
import { loansRouter } from "./modules/loans/loans.routes";
import { paymentsRouter } from "./modules/payments/payments.routes";
import { usersRouter } from "./modules/users/users.routes";

export function createApp() {
  const app = express();
  const limiters = createLimiters();

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);
  app.set("json replacer", (_key: string, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  // Swagger UI needs inline assets, so docs are mounted before helmet's CSP.
  app.use(docsRouter);

  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () =>
      logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }, "request"),
    );
    next();
  });

  app.use(limiters.api);
  app.use(createAuthRouter(limiters));

  app.use(authenticate);
  app.use(usersRouter);
  app.use(goldRatesRouter);
  app.use(customersRouter);
  app.use(appraisalsRouter);
  app.use(loansRouter);
  app.use(paymentsRouter);
  app.use(auditRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
