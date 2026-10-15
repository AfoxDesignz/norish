import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Each worker boots a whole stack (server, parser, Postgres, Redis) beside its
  // browser, so a worker costs two to three cores and over a gigabyte. On a
  // 10-core, 16 GB Mac, 5 and 8 workers overloaded it into timing reds, and 4
  // swapped out gigabytes per run: renderers crashed and Docker took longer
  // than testcontainers' fixed 30 s to bind a container's ports. CI runners
  // have 4 vCPUs, so CI takes its parallelism from shards instead.
  workers: process.env.CI ? 1 : 3,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./.results",
  use: {
    headless: true,
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "offline", testMatch: "offline/**/*.e2e.ts" },
    { name: "ai", testMatch: "ai/**/*.e2e.ts" },
    { name: "realtime", testMatch: "realtime/**/*.e2e.ts" },
  ],
});
