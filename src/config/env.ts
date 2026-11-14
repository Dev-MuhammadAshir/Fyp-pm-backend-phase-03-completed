import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables from .env
dotenv.config();

/**
 * Zod Schema for environment variable validation at startup (NFR-SEC-03).
 * Fails fast with clear validation diagnostics if required variables are missing or malformed.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z
    .string()
    .default("3000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(1024).max(65535)),
  HOST: z.string().default("0.0.0.0"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // PostgreSQL (Prisma) — with fallback for dev/standalone runtime
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required and must not be empty")
    .default("postgresql://postgres:postgres@localhost:5432/fyp_pm_dev"),

  // Redis 7 (defaults for localhost development are safe)
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z
    .string()
    .default("6379")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive()),
  REDIS_PASSWORD: z.string().optional().default(""),
  REDIS_TLS: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true" || val === "1")
    .pipe(z.boolean()),
  REDIS_DB: z
    .string()
    .default("0")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().nonnegative()),
  REDIS_JTI_DB: z
    .string()
    .default("1")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().nonnegative()),

  // JWT & Sessions (CA-06) — with fallback for dev/standalone runtime
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET must be at least 32 characters long")
    .default("dev_jwt_access_secret_key_minimum_32_characters_long_12345"),
  JWT_ACCESS_EXPIRES_IN: z
    .string()
    .default("900")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive()), // 900 seconds = 15 minutes
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters long")
    .default("dev_jwt_refresh_secret_key_minimum_32_characters_long_12345"),
  JWT_REFRESH_EXPIRES_IN: z
    .string()
    .default("604800")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive()), // 7 days in seconds
  BCRYPT_SALT_ROUNDS: z
    .string()
    .default("12")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(12, "BCrypt cost factor must be >= 12 per SRS DC-10")),

  // Security & Rate Limiting (NFR-SEC-08)
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000,http://localhost:5173"),
  RATE_LIMIT_WINDOW_MS: z
    .string()
    .default("900000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive()), // 15 minutes
  RATE_LIMIT_MAX: z
    .string()
    .default("100")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive()), // 100 requests / 15 min per user

  // Logging
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Storage
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./uploads"),
  STORAGE_MAX_FILE_SIZE_BYTES: z
    .string()
    .default("10485760")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive()), // 10 MB

  // PIRAE Rule Thresholds (CA-14)
  PIRAE_WORKLOAD_LOW_THRESHOLD: z
    .string()
    .default("0.70")
    .transform((val) => parseFloat(val)),
  PIRAE_WORKLOAD_MED_THRESHOLD: z
    .string()
    .default("0.90")
    .transform((val) => parseFloat(val)),
  PIRAE_WORKLOAD_HIGH_THRESHOLD: z
    .string()
    .default("1.20")
    .transform((val) => parseFloat(val)),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV !== "production") return;

  const DANGEROUS_PREFIXES = ["dev_jwt", "changeme", "test_"];

  const checkSecret = (
    value: string,
    path: "JWT_ACCESS_SECRET" | "JWT_REFRESH_SECRET",
  ): void => {
    const lowered = value.toLowerCase();
    if (DANGEROUS_PREFIXES.some((p) => lowered.includes(p))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path],
        message:
          `${path} appears to be a development default — ` +
          `production MUST supply a unique secret via env. ` +
          `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      });
    }
  };

  checkSecret(data.JWT_ACCESS_SECRET, "JWT_ACCESS_SECRET");
  checkSecret(data.JWT_REFRESH_SECRET, "JWT_REFRESH_SECRET");

  if (data.JWT_ACCESS_SECRET === data.JWT_REFRESH_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_REFRESH_SECRET"],
      message: "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

let parsedEnv: Env;

try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    const errorDetails = error.issues
      .map((issue) => ` - [${issue.path.join(".")}]: ${issue.message}`)
      .join("\n");
    console.error("❌ Environment validation failed:\n" + errorDetails);
  } else {
    console.error("❌ Unexpected error during environment validation:", error);
  }
  process.exit(1);
}

export const env = parsedEnv;
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = parsedEnv.DATABASE_URL;
}
