import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  CLIENT_REGISTRY,
  applyMcpConfiguration,
  detectClients,
  findExistingToken,
  generateMcpConfiguration,
  resolveClientPaths,
  type SetupMode,
} from "./config.js";

import { writePolicyPack, type PolicyClient } from "./policy.js";
import { multiSelectPrompt, selectPrompt } from "./prompt.js";

const VALID_CLIENTS = Object.keys(CLIENT_REGISTRY) as PolicyClient[];

interface Arguments {
  mode: SetupMode;
  clients?: PolicyClient[];
  token: string;
  projectRoot: string;
  configPath?: string;
  policyTarget?: string;
  apply: boolean;
  force: boolean;
  doctor: boolean;
  interactive: boolean;
}

const usage = () => {
  console.error(`Usage:
  pnpm setup:mcp [options]

Interactive Wizard:
  Run 'pnpm setup:mcp' with no flags to interactively select and configure detected AI tools.

Options:
  --client <client>         Specific agent: antigravity, cursor, claude, windsurf, cline, roo, codex, generic
  --clients <list>          Comma-separated list of agents to configure
  --mode <companion|safe>   Two MCP servers ('companion'), or one deny-by-default Safe Mode gateway ('safe')
  --token <token>           Defaults to ROVIEW_TOKEN or a newly generated token
  --project-root <dir>      Root directory of the Roview project (defaults to cwd)
  --config <path>           Explicit JSON MCP config path to preview or update
  --policy-target <dir>     Write the client policy pack into a game project directory
  --apply                   Atomically merge configuration into target config file(s)
  --force                   Replace conflicting Roview/Roblox entries
  --doctor                  Check the companion and official Studio MCP executable`);
};

const readValue = (args: string[], index: number) => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${args[index]}`);
  return value;
};

function parseArguments(argv: string[]): Arguments {
  let mode: SetupMode = "companion";
  let clients: PolicyClient[] | undefined;
  let token = process.env.ROVIEW_TOKEN ?? "";
  let projectRoot = process.cwd();
  let configPath: string | undefined;
  let policyTarget: string | undefined;
  let apply = false;
  let force = false;
  let doctor = false;

  if (argv.length === 0) {
    return {
      mode,
      token,
      projectRoot,
      apply: true,
      force: true,
      doctor: false,
      interactive: true,
    };
  }


  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--mode") {
      const value = readValue(argv, index);
      if (value !== "companion" && value !== "safe") throw new Error("--mode must be companion or safe");
      mode = value;
      index += 1;
    } else if (arg === "--client") {
      const value = readValue(argv, index);
      if (!VALID_CLIENTS.includes(value as PolicyClient)) {
        throw new Error(`--client must be one of: ${VALID_CLIENTS.join(", ")}`);
      }
      clients = [value as PolicyClient];
      index += 1;
    } else if (arg === "--clients") {
      const value = readValue(argv, index);
      const list = value.split(",").map((s) => s.trim()) as PolicyClient[];
      for (const item of list) {
        if (!VALID_CLIENTS.includes(item)) {
          throw new Error(`Unknown client in --clients list: '${item}'. Must be one of: ${VALID_CLIENTS.join(", ")}`);
        }
      }
      clients = list;
      index += 1;
    } else if (arg === "--token") {
      token = readValue(argv, index);
      index += 1;
    } else if (arg === "--project-root") {
      projectRoot = resolve(readValue(argv, index));
      index += 1;
    } else if (arg === "--config") {
      configPath = resolve(readValue(argv, index));
      index += 1;
    } else if (arg === "--policy-target") {
      policyTarget = resolve(readValue(argv, index));
      index += 1;
    } else if (arg === "--apply") apply = true;
    else if (arg === "--force") force = true;
    else if (arg === "--doctor") doctor = true;
    else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }

  if (apply && !configPath && !clients) {
    throw new Error("--apply requires --config or --client/--clients");
  }

  return {
    mode,
    ...(clients ? { clients } : {}),
    token: token || randomBytes(32).toString("hex"),
    projectRoot,
    ...(configPath ? { configPath } : {}),
    ...(policyTarget ? { policyTarget } : {}),
    apply,
    force,
    doctor,
    interactive: false,
  };
}

async function runDoctor() {
  const studioPath = "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP";
  if (process.platform === "darwin") {
    try {
      await access(studioPath);
      console.log("✔ Official Roblox Studio MCP executable found.");
    } catch {
      console.log("ℹ Roblox Studio MCP executable not found at default path (Studio might still be uninstalled or on Windows).");
    }
  }
  try {
    const response = await fetch("http://127.0.0.1:3219/healthz");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log("✔ Roview companion is running and healthy.");
  } catch {
    console.log("ℹ Roview companion is not currently running (start with 'pnpm start' or 'pnpm demo').");
  }
}

async function run() {
  const options = parseArguments(process.argv.slice(2));

  if (options.doctor) {
    await runDoctor();
    if (!options.clients && !options.configPath && !options.interactive) return;
  }

  let selectedClients = options.clients ?? [];
  let selectedMode = options.mode;

  if (options.interactive) {
    console.log("\n📐 \x1B[1mRoview MCP & Agent Setup\x1B[0m\n");

    const detected = await detectClients(options.projectRoot);
    const items = VALID_CLIENTS.map((id) => {
      const info = CLIENT_REGISTRY[id];
      const isDetected = detected.includes(id);
      return {
        id,
        name: info.name,
        description: isDetected ? `[Detected] ${info.description}` : info.description,
        selected: isDetected,
      };
    });

    selectedClients = await multiSelectPrompt({
      title: "Select the AI agents / IDEs you would like to configure:",
      items,
    });

    if (selectedClients.length === 0) {
      console.log("\nNo agents selected. Setup cancelled.\n");
      return;
    }

    selectedMode = await selectPrompt<SetupMode>({
      title: "Select Roview MCP Setup Mode:",
      items: [
        {
          id: "companion",
          name: "Companion Mode (Recommended)",
          description: "Keeps official Studio MCP for inspection and Roview MCP for human-approved mutations",
        },
        {
          id: "safe",
          name: "Safe Mode (Technical Enforcement)",
          description: "Proxies read-only Studio tools and denies raw mutations through a single gateway",
        },
      ],
      defaultIndex: 0,
    });
  }

  const configuration = generateMcpConfiguration({
    mode: selectedMode,
    projectRoot: options.projectRoot,
    ...(options.token ? { token: options.token } : {}),
  });


  const mutuallyExclusiveServers = selectedMode === "safe"
    ? ["Roblox_Studio", "roview"]
    : ["roview_safe"];

  console.log("\n⚙️  Applying Roview Configuration...\n");

  // If explicit single config path was passed
  if (options.configPath) {
    if (options.apply) {
      await applyMcpConfiguration(
        options.configPath,
        configuration,
        options.force,
        mutuallyExclusiveServers,
      );
      console.log(`  ✔ Updated MCP config: ${options.configPath}`);
    } else {
      console.log(JSON.stringify(configuration, null, 2));
    }
  }

  // If clients are selected (interactively or via --client/--clients)
  const targetDir = options.policyTarget ?? options.projectRoot;
  for (const client of selectedClients) {
    const { mcpConfigPath } = resolveClientPaths(client, targetDir);

    // Apply MCP config if available and applying
    if (mcpConfigPath && options.apply) {
      try {
        await applyMcpConfiguration(
          mcpConfigPath,
          configuration,
          options.force,
          mutuallyExclusiveServers,
        );
        console.log(`  ✔ Configured ${CLIENT_REGISTRY[client].name} MCP: ${mcpConfigPath}`);
      } catch (err) {
        console.warn(`  ⚠️ Could not auto-write ${CLIENT_REGISTRY[client].name} MCP config (${mcpConfigPath}): ${(err as Error).message}`);
      }
    }

    // Write policy pack
    try {
      const policyPath = await writePolicyPack(targetDir, client);
      console.log(`  ✔ Wrote policy pack for ${CLIENT_REGISTRY[client].name}: ${policyPath}`);
    } catch (err) {
      console.warn(`  ⚠️ Could not write policy pack for ${CLIENT_REGISTRY[client].name}: ${(err as Error).message}`);
    }
  }

  let pluginBuilt = false;
  try {
    await access(join(options.projectRoot, "roview-plugin.rbxm"));
    pluginBuilt = true;
  } catch {}

  console.log("\n🎉 Setup Complete!\n");
  console.log(`  Mode:        ${selectedMode === "companion" ? "Companion Mode (Roblox_Studio + roview)" : "Safe Mode (roview_safe gateway)"}`);
  console.log(`  Session:     \x1B[32mAuto-discovered on loopback (http://127.0.0.1:3219)\x1B[0m`);
  console.log("\nNext Steps:");
  if (!pluginBuilt) {
    console.log("  1. Build Studio plugin:  pnpm build:plugin  (creates roview-plugin.rbxm)");
    console.log("  2. Start companion:      pnpm start  (or pnpm demo)");
    console.log("  3. Open Studio & pair:   Install plugin in Studio and pair via widget code.");
    console.log("  4. Agent review:         Your AI agents will now route Studio mutations through Roview!\n");
  } else {
    console.log("  1. Start companion:      pnpm start  (or pnpm demo)");
    console.log("  2. Open Studio & pair:   Pair the Roview plugin widget using the pairing code.");
    console.log("  3. Agent review:         Your AI agents will now route Studio mutations through Roview!\n");
  }
}



try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Roview MCP setup failed");
  usage();
  process.exitCode = 1;
}

