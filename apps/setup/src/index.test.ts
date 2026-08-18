import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const setupCliPath = resolve(__dirname, "index.ts");
const tsxPath = resolve(__dirname, "../../../node_modules/.bin/tsx");

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "roview-setup-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function runSetup(args: string[]) {
  return execFileAsync(tsxPath, [setupCliPath, ...args], {
    env: { ...process.env },
  });
}

describe("Setup CLI Component Tests (apps/setup)", () => {
  it("prints doctor check results with --doctor flag", async () => {
    const { stdout } = await runSetup(["--doctor"]);
    expect(stdout).toContain("Roview companion");
  });

  it("previews configuration JSON when given --config without --apply", async () => {
    const fakeConfigPath = join(tempDir, "mcp.json");
    const { stdout } = await runSetup([
      "--config", fakeConfigPath,
      "--mode", "companion",
      "--token", "test-preview-token",
    ]);
    expect(stdout).toContain('"roview"');
    expect(stdout).toContain('"ROVIEW_TOKEN": "test-preview-token"');
  });

  it("writes MCP configuration to target config file with --apply", async () => {
    const targetConfig = join(tempDir, "test-mcp-config.json");
    const { stdout } = await runSetup([
      "--config", targetConfig,
      "--mode", "companion",
      "--token", "test-apply-token",
      "--apply",
    ]);
    expect(stdout).toContain(`✔ Updated MCP config: ${targetConfig}`);

    const writtenContent = JSON.parse(await readFile(targetConfig, "utf8")) as {
      mcpServers: { roview: { env: { ROVIEW_TOKEN: string } } };
    };
    expect(writtenContent.mcpServers.roview.env.ROVIEW_TOKEN).toBe("test-apply-token");
  });

  it("configures specific client and generates policy pack", async () => {
    const policyTargetDir = join(tempDir, "roblox-project");
    const { stdout } = await runSetup([
      "--client", "cursor",
      "--mode", "companion",
      "--token", "test-token",
      "--policy-target", policyTargetDir,
      "--apply",
    ]);

    expect(stdout).toContain("Wrote policy pack for Cursor");
    const cursorRules = await readFile(join(policyTargetDir, ".cursor", "rules", "roview.mdc"), "utf8");
    expect(cursorRules).toContain("Roview");
    expect(cursorRules).toContain("review_changes");
  });

  it("supports Safe Mode gateway configuration", async () => {
    const targetConfig = join(tempDir, "safe-mcp-config.json");
    await runSetup([
      "--config", targetConfig,
      "--mode", "safe",
      "--token", "safe-token",
      "--apply",
    ]);

    const writtenContent = JSON.parse(await readFile(targetConfig, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(writtenContent.mcpServers)).toEqual(["roview_safe"]);
  });
});
