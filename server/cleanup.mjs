import { loadConfig } from "./config.mjs";
import { createDatabase } from "./database.mjs";

const db = createDatabase(loadConfig());
try {
  const sessions = await db.query("DELETE FROM sessions WHERE expires_at < NOW()");
  const transactions = await db.query("DELETE FROM oauth_transactions WHERE expires_at < NOW()");
  console.log(`Removed ${sessions.rowCount} expired sessions and ${transactions.rowCount} expired sign-in transactions.`);
} finally { await db.end(); }
