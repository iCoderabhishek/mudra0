// Runs before any test file is loaded: point the app at the test database
// and turn off external services so tests are self-contained.
process.env.NODE_ENV = "test";
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.REDIS_URL = "";
process.env.SMTP_HOST = "";
process.env.AUTH_SECRET ??= "test-secret-at-least-16-chars";
