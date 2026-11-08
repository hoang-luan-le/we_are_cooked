import { defineConfig } from "@playwright/test";

const port = process.env.WORLD_PORT ?? "3220";
const origin = `http://127.0.0.1:${port}`;
const api = process.env.NIGHT_TEST_API_ORIGIN ?? "";

// 3D walkthrough. Uses installed Chrome on the real GPU so frame times mean something.
export default defineConfig({
  testDir: "./tests-world",
  testMatch: /world.*\.spec\.ts/,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: origin,
    viewport: { width: 1600, height: 900 },
    video: process.env.CAPTURE_VIDEO ? { mode: "on", size: { width: 1280, height: 720 } } : "off",
    launchOptions: {
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
      args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", ...(process.env.CAPTURE_PERF ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : [])],
    },
  },
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: origin,
    reuseExistingServer: false,
    env: {
      NIGHT_FIXTURES: "1",
      MORNING_GITHUB_FIXTURE: api ? "1" : "",
      NIGHT_TEAM_ENTRY: api ? "1" : "",
      NIGHT_API_ORIGIN: api,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
