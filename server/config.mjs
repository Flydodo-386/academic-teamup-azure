import { z } from "zod";

const boolean = (value) => value === "true";
const schema = z.object({
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  ENTRA_TENANT_ID: z.string().uuid(),
  ENTRA_CLIENT_ID: z.string().uuid(),
  ENTRA_CLIENT_SECRET: z.string().min(1),
  REQUIRED_ENTRA_ROLE: z.string().default("TeamUp.User"),
  ADMIN_ENTRA_ROLE: z.string().min(1).default("TeamUp.Admin"),
  DATABASE_TLS: z.enum(["true", "false"]).default("true"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  ENABLE_DEV_LOGIN: z.enum(["true", "false"]).default("false"),
  SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});

export function loadConfig(environment = process.env) {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Missing/invalid configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}. See .env.example.`);
  }
  const raw = parsed.data;
  const origin = new URL(raw.APP_ORIGIN);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("APP_ORIGIN must be an origin, without a path or credentials.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (raw.NODE_ENV === "production" && origin.protocol !== "https:") throw new Error("Production APP_ORIGIN must use HTTPS.");
  if (boolean(raw.ENABLE_DEV_LOGIN) && (raw.NODE_ENV === "production" || !local)) throw new Error("Development login is forbidden in production or on a non-local origin.");
  if (raw.NODE_ENV === "production" && !boolean(raw.DATABASE_TLS)) throw new Error("Production PostgreSQL connections must use verified TLS.");
  return {
    origin: origin.origin, databaseUrl: raw.DATABASE_URL, databaseTls: boolean(raw.DATABASE_TLS),
    databaseCaFile: environment.DATABASE_CA_FILE || "", tenantId: raw.ENTRA_TENANT_ID.toLowerCase(),
    clientId: raw.ENTRA_CLIENT_ID, clientSecret: raw.ENTRA_CLIENT_SECRET,
    requiredRole: raw.REQUIRED_ENTRA_ROLE, adminRole: raw.ADMIN_ENTRA_ROLE,
    production: raw.NODE_ENV === "production", developmentLogin: boolean(raw.ENABLE_DEV_LOGIN),
    sessionHours: raw.SESSION_HOURS, port: raw.PORT, trustProxyHops: raw.TRUST_PROXY_HOPS,
    institutionName: environment.INSTITUTION_NAME?.trim() || "Your institution",
    fundingCalendarUrl: safeWebUrl(environment.FUNDING_CALENDAR_URL || ""),
  };
}

export function safeWebUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}
