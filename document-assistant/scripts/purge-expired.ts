/** Runs the retention clean-up once (the app also does this automatically every six hours). */
import { getConfig } from "../src/server/config";
import { createDatabase, setDbForTesting } from "../src/server/db/client";
import { purgeExpired } from "../src/server/services/retention";

const { db, close } = await createDatabase(getConfig().DATABASE_URL);
setDbForTesting(db);
console.log("Removed:", await purgeExpired(db));
await close();
