import { defineConfig } from "@playwright/test";

const origin = "http://127.0.0.1:3220";
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
    launchOptions: {
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
      args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync=false"],
    },
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3220",
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
