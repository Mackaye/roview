import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");
const tempDir = mkdtempSync(join(tmpdir(), "roview-smoke-"));

try {
  console.log("📦 1. Packing npm tarball in isolated directory...");
  const packOutput = execSync(`npm pack --pack-destination "${tempDir}"`, {
    cwd: rootDir,
    encoding: "utf8",
  }).trim();

  const tarballName = packOutput.split("\n").pop().trim();
  const tarballPath = join(tempDir, tarballName);

  if (!existsSync(tarballPath)) {
    throw new Error(`Tarball not found at ${tarballPath}`);
  }
  console.log(`  ✔ Generated: ${tarballName}`);

  console.log("📋 2. Verifying tarball file manifest...");
  const tarList = execSync(`tar -tzf "${tarballPath}"`, { encoding: "utf8" });
  const requiredFiles = [
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/dist/bin/roview.js",
    "package/dist/protocol/index.js",
    "package/dist/protocol/index.d.ts",
    "package/dist/public/index.html",
    "package/dist/public/app.js",
    "package/dist/public/styles.css",
    "package/dist/assets/roview-plugin.rbxm",
  ];

  for (const file of requiredFiles) {
    if (!tarList.includes(file)) {
      throw new Error(`Missing expected file in tarball: ${file}`);
    }
  }
  console.log("  ✔ All essential build artifacts, webview assets, and types present in package");

  console.log("📥 3. Installing package in clean consumer project...");
  const consumerDir = join(tempDir, "consumer");
  execSync(`mkdir -p "${consumerDir}"`);
  execSync("npm init -y", { cwd: consumerDir, stdio: "ignore" });
  execSync(`npm install "${tarballPath}"`, { cwd: consumerDir, stdio: "ignore" });
  console.log("  ✔ Successfully installed tarball");

  console.log("🚀 4. Verifying CLI executable binary...");
  const versionOutput = execSync("npx roview --version", {
    cwd: consumerDir,
    encoding: "utf8",
  }).trim();
  if (!versionOutput.startsWith("roview v")) {
    throw new Error(`Unexpected CLI version output: ${versionOutput}`);
  }
  console.log(`  ✔ CLI version check: ${versionOutput}`);

  const pluginPathOutput = execSync("npx roview plugin path", {
    cwd: consumerDir,
    encoding: "utf8",
  }).trim();
  if (!/roblox/i.test(pluginPathOutput) || !pluginPathOutput.includes("Plugins")) {
    throw new Error(`Unexpected CLI plugin path: ${pluginPathOutput}`);
  }
  console.log(`  ✔ CLI plugin path resolution: ${pluginPathOutput}`);

  console.log("🔍 5. Verifying ESM package module exports...");
  execSync(
    `node --input-type=module -e 'import { proposalDigest, canonicalJson } from "@mackaye/roview"; if (typeof proposalDigest !== "function") process.exit(1);'`,
    { cwd: consumerDir, stdio: "inherit" },
  );
  execSync(
    `node --input-type=module -e 'import { proposalDigest } from "@mackaye/roview/protocol"; if (typeof proposalDigest !== "function") process.exit(1);'`,
    { cwd: consumerDir, stdio: "inherit" },
  );
  console.log("  ✔ Root export (@mackaye/roview) and subpath export (@mackaye/roview/protocol) load successfully");

  console.log("\n✅ Package smoke test passed! The NPM package is valid, complete, and fully functional.\n");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
