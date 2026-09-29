import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Pin the process time zone to something that is NOT New York so any code
    // that accidentally relies on the machine's local zone fails the tests.
    env: { TZ: "Asia/Tokyo" },
  },
});
