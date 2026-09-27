import { defineConfig, devices } from "@playwright/test";

// 3100, e não 3000: é a porta do `pnpm start:e2e` (servidor de produção com o
// Global Config falso de `scripts/edge-config-falso.ts`). A 3000 é a do
// `pnpm dev`, e um `test:e2e` que caísse nela auditaria o servidor de
// desenvolvimento — outro bundle, outros elementos, outra fonte de dado.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],
});
