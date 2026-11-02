// Runs before any test file is loaded: point the app at the test database,
// apply migrations to it, and turn off external services so tests are self-contained.
process.env.NODE_ENV = "test";
process.env.REDIS_URL = "";
process.env.SMTP_HOST = "";
process.env.AUTH_SECRET ??= "test-secret-at-least-16-chars";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const migrate = Bun.spawnSync(["bunx", "--bun", "prisma", "migrate", "deploy"], {
    env: process.env,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (migrate.exitCode !== 0) {
    console.error(migrate.stderr.toString());
    throw new Error("Could not migrate the test database");
  }
}
