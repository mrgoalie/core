/** Adds the fictional demonstration employees and baseline data (development and demos only). */
import { getConfig } from "../src/server/config";
import { createDatabase } from "../src/server/db/client";
import { ensureBaseline } from "../src/server/db/bootstrap";

const config = getConfig();
if (config.isProduction) {
  console.error("Refusing to add demonstration data to a production environment.");
  process.exit(1);
}
const { db, close } = await createDatabase(config.DATABASE_URL, { migrate: true });
await ensureBaseline(db, { seedDemo: true });
await close();
console.log("Demonstration data is ready. Start the app with: npm run dev");
