import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    coverage: {
      reporter: ["text", "html"],
      // All source files, so a file no test loads still counts (as 0%).
      include: ["src/**/*.{ts,tsx}"],
      // layout.tsx is the root <html> layout: only Next.js renders it (every e2e test does).
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/lib/api-types.ts", "src/app/layout.tsx"],
      // `npm run test:coverage` fails below these. Dragging cards is the main gap: it needs
      // real pointer geometry, so the Playwright tests cover it instead.
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "tests"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
