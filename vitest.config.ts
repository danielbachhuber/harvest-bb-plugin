import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["**/*.test.ts", "**/*.test.tsx"], exclude: ["node_modules/**"] },
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
});
