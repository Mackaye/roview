import { chmod, copyFile, cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      "bin/roview": "apps/cli/src/index.ts",
    },
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    clean: false,
    splitting: false,
    sourcemap: true,
    async onSuccess() {
      console.log("📦 Copying static webview assets and plugin bundle into dist/...");
      await mkdir("dist/public", { recursive: true });
      await cp("apps/companion/public", "dist/public", { recursive: true });
      console.log("  ✔ Copied companion webview assets to dist/public");

      await mkdir("dist/assets", { recursive: true });
      if (existsSync("roview-plugin.rbxm")) {
        await copyFile("roview-plugin.rbxm", "dist/assets/roview-plugin.rbxm");
        console.log("  ✔ Copied roview-plugin.rbxm to dist/assets/roview-plugin.rbxm");
      }

      if (existsSync("dist/bin/roview.js")) {
        await chmod("dist/bin/roview.js", 0o755);
        console.log("  ✔ Set executable permissions on dist/bin/roview.js");
      }
    },
  },
  {
    entry: {
      "protocol/index": "packages/protocol/src/index.ts",
    },
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    dts: true,
    splitting: false,
    sourcemap: true,
  },
]);
