import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: optional,
  AUTH_SECRET: z.string().min(16),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM: z.string().default("Swarn Sathi <no-reply@swarnsathi.test>"),
  TRUST_PROXY: z.coerce.number().int().default(0),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
