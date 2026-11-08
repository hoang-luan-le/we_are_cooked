import { defineConfig } from "@playwright/test";

const origin = "http://127.0.0.1:3210";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: origin,
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3210",
    url: origin,
    env: {
      NIGHT_FIXTURES: "1",
      MORNING_GITHUB_FIXTURE: process.env.NIGHT_TEST_MORNING ?? "",
      NIGHT_TEAM_ENTRY: process.env.NIGHT_TEST_TEAM_ENTRY ?? "",
      NIGHT_API_ORIGIN: process.env.NIGHT_TEST_API_ORIGIN ?? "",
      DANA_DEV_WS_BASE: process.env.NIGHT_TEST_RELAY_BASE ?? "ws://127.0.0.1:3211",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
