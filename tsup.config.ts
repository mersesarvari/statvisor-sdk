import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/browser.ts", "src/StatvisorAnalytics.tsx"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  outDir: "dist",
  // Rename ESM output to .mjs
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".js" };
  },
});
