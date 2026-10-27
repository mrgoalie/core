import { defineConfig } from "@playwright/test";

const PORT = 3100;

/**
 * End-to-end acceptance tests run against a production build (`npm run build` first) with a fresh,
 * fictional demonstration database. Tests run in order because later demonstrations build on earlier ones.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", viewport: { width: 1280, height: 900 } },
  webServer: {
    command: `rm -rf data/e2e && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      APP_ENV: "development",
      AUTH_MODE: "development",
      APP_BASE_URL: `http://localhost:${PORT}`,
      DATABASE_URL: "pglite:./data/e2e/db",
      STORAGE_LOCAL_DIR: "./data/e2e/storage",
      SEED_DEMO_DATA: "true",
      CASE_MANAGEMENT: "mock",
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
