import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCompanion } from "../../companion/src/server.js";

const execFileAsync = promisify(execFile);
const token = "test-token-cli-suite-0123456789";
const activeServers: ReturnType<typeof createCompanion>["server"][] = [];

afterEach(async () => {
  await Promise.all(
    activeServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

async function startServer() {
  const companion = createCompanion({ token });
  activeServers.push(companion.server);
  await new Promise<void>((resolve) => companion.server.listen(0, "127.0.0.1", resolve));
  const { port } = companion.server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    token,
  };
}

const cliPath = resolve(__dirname, "index.ts");
const tsxPath = resolve(__dirname, "../../../node_modules/.bin/tsx");
const fixturePath = resolve(__dirname, "../../../packages/fixtures/proposals/daily-reward.json");

async function runCli(args: string[], env: Record<string, string> = {}) {
  return execFileAsync(tsxPath, [cliPath, ...args], {
    env: { ...process.env, ...env },
  });
}

describe("CLI Component Tests (apps/cli)", () => {
  it("fails with error if ROVIEW_TOKEN is missing", async () => {
    await expect(runCli(["doctor"], { ROVIEW_TOKEN: "", ROVIEW_URL: "http://127.0.0.1:3219" }))
      .rejects.toThrow("ROVIEW_TOKEN is required");
  });

  it("fails if connecting to a non-loopback URL", async () => {
    await expect(
      runCli(["doctor"], { ROVIEW_TOKEN: token, ROVIEW_URL: "http://external.example.com:3219" })
    ).rejects.toThrow("The prototype CLI connects to loopback companions only");
  });

  it("executes doctor command against companion", async () => {
    const { baseUrl, token } = await startServer();
    const { stdout } = await runCli(["doctor"], { ROVIEW_TOKEN: token, ROVIEW_URL: baseUrl });
    expect(stdout).toContain("Companion reachable");
    expect(stdout).toContain("authenticated: true");
    expect(stdout).toContain("loopback only: true");
    expect(stdout).toContain("protocol: 0.1");
  });

  it("executes submit and list commands", async () => {
    const { baseUrl, token } = await startServer();
    const env = { ROVIEW_TOKEN: token, ROVIEW_URL: baseUrl };

    // Initially empty list
    const initialList = await runCli(["list"], env);
    expect(initialList.stdout).toContain("No proposals.");

    // Submit fixture proposal
    const submitResult = await runCli(["submit", fixturePath], env);
    expect(submitResult.stdout).toContain("demo_daily_reward r1");
    expect(submitResult.stdout).toContain("READY_FOR_REVIEW");

    // List reflects submitted proposal
    const updatedList = await runCli(["list"], env);
    expect(updatedList.stdout).toContain("demo_daily_reward r1");
    expect(updatedList.stdout).toContain("READY_FOR_REVIEW");
  });

  it("executes status and cancel commands", async () => {
    const { baseUrl, token } = await startServer();
    const env = { ROVIEW_TOKEN: token, ROVIEW_URL: baseUrl };

    await runCli(["submit", fixturePath], env);

    // Query status
    const statusResult = await runCli(["status", "demo_daily_reward", "1"], env);
    expect(statusResult.stdout).toContain("demo_daily_reward r1");
    expect(statusResult.stdout).toContain("READY_FOR_REVIEW");

    // Cancel proposal
    const cancelResult = await runCli(["cancel", "demo_daily_reward", "1"], env);
    expect(cancelResult.stdout).toContain("demo_daily_reward r1");
    expect(cancelResult.stdout).toContain("CANCELLED");

    // Status after cancel
    const statusAfterCancel = await runCli(["status", "demo_daily_reward", "1"], env);
    expect(statusAfterCancel.stdout).toContain("CANCELLED");
  });

  it("executes data-delete --yes to purge terminal proposal data", async () => {
    const { baseUrl, token } = await startServer();
    const env = { ROVIEW_TOKEN: token, ROVIEW_URL: baseUrl };

    await runCli(["submit", fixturePath], env);
    await runCli(["cancel", "demo_daily_reward", "1"], env);

    // data-delete requires --yes flag
    await expect(runCli(["data-delete"], env)).rejects.toThrow("Refusing to delete local review data without --yes");

    // data-delete with --yes
    const deleteResult = await runCli(["data-delete", "--yes"], env);
    expect(deleteResult.stdout).toContain("Deleted 1 local proposal record(s).");

    const listAfterDelete = await runCli(["list"], env);
    expect(listAfterDelete.stdout).toContain("No proposals.");
  });

  it("prints version and help information", async () => {
    const versionResult = await runCli(["--version"]);
    expect(versionResult.stdout).toMatch(/roview v\d+\.\d+\.\d+/);

    await expect(runCli(["--help"])).rejects.toThrow();
  });

  it("executes plugin subcommands through CLI", async () => {
    const pathResult = await runCli(["plugin", "path"]);
    expect(pathResult.stdout).toContain("Roblox");
    expect(pathResult.stdout).toContain("Plugins");
  });
});

