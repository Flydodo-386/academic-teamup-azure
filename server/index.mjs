import { loadConfig } from "./config.mjs";
import { createDatabase } from "./database.mjs";
import { migrate } from "./migrate.mjs";
import { createApp } from "./app.mjs";

const config = loadConfig();
const db = createDatabase(config);
await migrate(db);
const server = createApp(db, config).listen(config.port, "0.0.0.0", () => console.log(`TeamUp listening on port ${config.port}.`));
const cleanupTimer = setInterval(async () => {
  try {
    await db.query("DELETE FROM sessions WHERE expires_at < NOW()");
    await db.query("DELETE FROM oauth_transactions WHERE expires_at < NOW()");
  } catch { console.warn("Expired-session cleanup could not run."); }
}, 3600000);
cleanupTimer.unref();
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanupTimer);
  server.close(async () => { await db.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 15000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
