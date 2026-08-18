#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startCompanion } from "../../companion/src/server.js";
import { runSetup } from "../../setup/src/index.js";
import { installPlugin, uninstallPlugin, getPluginStatus, getRobloxPluginsDir } from "./plugin.js";

const DEFAULT_URL = "http://127.0.0.1:3219";
const VERSION = "0.1.0";

function usage(): never {
  console.log(`\x1B[1mRoview CLI\x1B[0m - AI-assisted Roblox Studio review & safety tools (v${VERSION})

\x1B[1mUSAGE\x1B[0m
  roview <command> [arguments...]

\x1B[1mSERVER & SETUP COMMANDS\x1B[0m
  start, companion          Start the loopback companion server
                            Options: --port <port>, --token <token>, --demo, --retention-days <days>
  setup                     Interactive MCP setup wizard for AI clients (Cursor, Claude, Windsurf, etc.)
  mcp [--safe]              Launch stdio MCP server (or Safe Mode proxy gateway)

\x1B[1mSTUDIO PLUGIN COMMANDS\x1B[0m
  plugin install            Auto-detect Studio plugin directory and install Roview.rbxm
                            Options: --file <path>, --dir <path>
  plugin uninstall          Remove Roview.rbxm from local Studio plugins directory
                            Options: --dir <path>
  plugin path               Print the resolved local Studio plugin directory
  plugin status             Check if the plugin is installed and view file metadata

\x1B[1mPROPOSAL COMMANDS\x1B[0m
  submit <proposal.json>    Submit a proposed mutation JSON to active companion
  list                      List all active and recent proposals
  status <id> <revision>    Inspect status and execution result of a proposal
  cancel <id> <revision>    Cancel a pending proposal
  doctor                    Run diagnostic connectivity checks
  data-delete --yes         Purge expired proposal records from companion store

\x1B[1mOPTIONS\x1B[0m
  -v, --version             Show CLI version
  -h, --help                Show this help message

\x1B[2mSet ROVIEW_TOKEN to your session token if authenticating to a remote or non-default companion.\x1B[0m`);
  process.exit(1);
}

function configuration() {
  const token = process.env.ROVIEW_TOKEN;
  if (!token) throw new Error("ROVIEW_TOKEN is required");
  const baseUrl = new URL(process.env.ROVIEW_URL ?? DEFAULT_URL);
  if (!["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname)) {
    throw new Error("The prototype CLI connects to loopback companions only");
  }
  return { token, baseUrl: baseUrl.toString().replace(/\/$/, "") };
}

async function request(path: string, init?: RequestInit) {
  const { token, baseUrl } = configuration();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Companion returned HTTP ${response.status}`);
  }
  return body;
}

function summary(record: Record<string, unknown>) {
  const proposal = record.proposal as Record<string, unknown>;
  return `${proposal.proposalId} r${proposal.revision}  ${record.status}  ${proposal.title}`;
}

async function handlePluginCommand(subcommand?: string, args: string[] = []) {
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    console.log(`Usage:
  roview plugin install [--file <path>] [--dir <path>]
  roview plugin uninstall [--dir <path>]
  roview plugin path
  roview plugin status`);
    return;
  }

  let customFile: string | undefined;
  let customDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const current = args[i];
    const next = args[i + 1];
    if (current === "--file" && typeof next === "string") {
      customFile = resolve(next);
      i++;
    } else if (current === "--dir" && typeof next === "string") {
      customDir = resolve(next);
      i++;
    }
  }

  if (subcommand === "path") {
    console.log(customDir ?? getRobloxPluginsDir());
    return;
  }

  if (subcommand === "status" || subcommand === "info") {
    const status = await getPluginStatus({ pluginsDir: customDir });
    console.log(`Roblox Studio Plugins Directory: ${status.pluginsDir}`);
    if (status.installed) {
      console.log(`✔ Plugin installed: ${status.pluginPath}`);
      if (typeof status.bytes === "number") console.log(`  Size: ${(status.bytes / 1024).toFixed(1)} KB`);
      if (status.modifiedAt) console.log(`  Modified: ${status.modifiedAt}`);
    } else {
      console.log(`✖ Plugin not installed. Run 'roview plugin install' to install.`);
      if (!status.dirExists) {
        console.log(`\n\x1B[33m⚠️  Warning: The default Plugins directory was not found on your system.\x1B[0m\n`);
      }
      if (status.troubleshooting) {
        console.log(`\n${status.troubleshooting}`);
      }
    }
    return;
  }

  if (subcommand === "install") {
    const result = await installPlugin({ sourcePath: customFile, pluginsDir: customDir });
    console.log(`✔ Successfully installed Roview Studio Plugin!`);
    console.log(`  Source: ${result.sourcePath}`);
    console.log(`  Target: ${result.targetPath} (${(result.bytes / 1024).toFixed(1)} KB)`);
    if (result.dirCreated && !result.isCustomDir) {
      console.log(`\n\x1B[33mℹ Created directory: ${result.targetPath.replace(/Roview\.rbxm$/, "")}\x1B[0m`);
      console.log(`  If Studio was already open, you may need to restart Studio for it to scan the new folder.`);
      console.log(`  If your Studio uses a custom location, click 'Plugins Folder' in Studio and run:`);
      console.log(`  roview plugin install --dir "<path-from-studio>"`);
    }
    console.log(`\nNext: Open or restart Roblox Studio, and the Roview widget will appear in your Plugins ribbon.`);
    return;
  }

  if (subcommand === "uninstall") {
    const result = await uninstallPlugin({ pluginsDir: customDir });
    if (result.existed) {
      console.log(`✔ Uninstalled Roview plugin from: ${result.targetPath}`);
    } else {
      console.log(`ℹ Roview plugin was not found at: ${result.targetPath}`);
    }
    return;
  }

  throw new Error(`Unknown plugin subcommand: '${subcommand}'. Valid commands: install, uninstall, path, status.`);
}

async function handleStartCommand(args: string[]) {
  let port: number | undefined;
  let token: string | undefined;
  let demoFixture = false;
  let retentionDays: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const current = args[i];
    const next = args[i + 1];
    if (current === "--port" && typeof next === "string") {
      port = Number(next);
      i++;
    } else if (current === "--token" && typeof next === "string") {
      token = next;
      i++;
    } else if (current === "--demo") {
      demoFixture = true;
    } else if (current === "--retention-days" && typeof next === "string") {
      retentionDays = Number(next);
      i++;
    }
  }

  await startCompanion({ port, token, demoFixture, retentionDays });
}

async function handleMcpCommand(args: string[]) {
  const isSafe = args.includes("--safe");
  if (isSafe) {
    await import("../../mcp/src/safe-index.js");
  } else {
    await import("../../mcp/src/index.js");
  }
}

async function run() {
  const [, , command, ...args] = process.argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    usage();
  }

  if (command === "--version" || command === "-v") {
    console.log(`roview v${VERSION}`);
    return;
  }

  if (command === "plugin") {
    await handlePluginCommand(args[0], args.slice(1));
    return;
  }

  if (command === "start" || command === "companion") {
    await handleStartCommand(args);
    return;
  }

  if (command === "setup") {
    await runSetup(args);
    return;
  }

  if (command === "mcp") {
    await handleMcpCommand(args);
    return;
  }

  if (command === "submit") {
    const file = args[0];
    if (!file) usage();
    const raw = await readFile(file, "utf8");
    const record = await request("/v1/proposals", { method: "POST", body: raw });
    console.log(summary(record));
    return;
  }

  if (command === "list") {
    const body = await request("/v1/proposals");
    const proposals = body.proposals as Record<string, unknown>[];
    if (proposals.length === 0) console.log("No proposals.");
    else for (const record of proposals) console.log(summary(record));
    return;
  }

  if (command === "status") {
    const [proposalId, revisionText] = args;
    const revision = Number(revisionText);
    if (!proposalId || !Number.isInteger(revision) || revision < 1) usage();
    const record = await request(`/v1/proposals/${encodeURIComponent(proposalId)}/${revision}`);
    console.log(summary(record));
    const result = record.applyResult as Record<string, unknown> | undefined;
    if (result) console.log(`  ${result.success ? "success" : "failed"}: ${result.message}`);
    return;
  }

  if (command === "cancel") {
    const [proposalId, revisionText] = args;
    const revision = Number(revisionText);
    if (!proposalId || !Number.isInteger(revision) || revision < 1) usage();
    const record = await request(
      `/v1/proposals/${encodeURIComponent(proposalId)}/${revision}/cancel`,
      { method: "POST", body: "{}" }
    );
    console.log(summary(record));
    return;
  }

  if (command === "doctor") {
    const report = await request("/v1/doctor");
    console.log("Companion reachable");
    console.log(`  authenticated: ${String(report.authenticated)}`);
    console.log(`  loopback only: ${String(report.loopback)}`);
    console.log(`  protocol: ${String(report.protocolVersion)}`);
    console.log(`  proposals: ${String(report.proposalCount)}`);
    return;
  }

  if (command === "data-delete") {
    if (args[0] !== "--yes") {
      throw new Error("Refusing to delete local review data without --yes");
    }
    const result = await request("/v1/data", { method: "DELETE" });
    console.log(`Deleted ${String(result.deleted)} local proposal record(s).`);
    return;
  }

  usage();
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Roview CLI failed");
  process.exitCode = 1;
}
