import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";

createApp().listen(env.PORT, () => {
  logger.info(`Swarn Sathi API listening on http://localhost:${env.PORT} (docs at /docs)`);
});
