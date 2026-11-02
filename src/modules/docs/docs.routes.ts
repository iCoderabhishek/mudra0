import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { parse } from "yaml";

const spec = parse(readFileSync(join(import.meta.dir, "../../../docs/openapi.yaml"), "utf8"));

export const docsRouter = Router();

docsRouter.get("/openapi.json", (_req, res) => {
  res.json(spec);
});
docsRouter.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));
