import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir as osHomedir } from "node:os";
import { randomUUID } from "node:crypto";
import { policyRelativePath, type PolicyClient } from "./policy.js";

export type SetupMode = "companion" | "safe";

interface StdioServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfiguration {
  mcpServers: Record<string, StdioServerEntry>;
}

interface GenerateConfigurationOptions {
  mode: SetupMode;
  projectRoot: string;
  token?: string;
  roviewUrl?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
}

export interface ClientInfo {
  id: PolicyClient;
  name: string;
  description: string;
  defaultMcpConfigPath?: (projectRoot: string, homedir?: string, platform?: NodeJS.Platform) => string | undefined;
}

const officialStudioEntry = (
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): StdioServerEntry => {
  if (platform === "darwin") {
    return { command: "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP" };
  }
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    if (!localAppData) throw new Error("LOCALAPPDATA is required to configure Roblox Studio MCP on Windows");
    return { command: "cmd.exe", args: ["/c", `${localAppData}\\Roblox\\mcp.bat`] };
  }
  return { command: environment.ROBLOX_STUDIO_MCP_PATH ?? "roblox-studio-mcp" };
};

export function generateMcpConfiguration(options: GenerateConfigurationOptions): McpConfiguration {
  const env: Record<string, string> = {
    ROVIEW_URL: options.roviewUrl ?? "http://127.0.0.1:3219",
  };
  if (options.token) {
    env.ROVIEW_TOKEN = options.token;
  }

  const roviewEntry: StdioServerEntry = {
    command: "pnpm",
    args: ["--dir", options.projectRoot, options.mode === "safe" ? "mcp:safe" : "mcp"],
    env,
  };


  if (options.mode === "safe") {
    return { mcpServers: { roview_safe: roviewEntry } };
  }

  return {
    mcpServers: {
      Roblox_Studio: officialStudioEntry(options.platform ?? process.platform, options.environment ?? process.env),
      roview: roviewEntry,
    },
  };
}

const sameEntry = (left: StdioServerEntry, right: StdioServerEntry) => JSON.stringify(left) === JSON.stringify(right);

export function mergeMcpConfiguration(
  current: McpConfiguration,
  incoming: McpConfiguration,
  force = false,
  removeServerNames: string[] = [],
): McpConfiguration {
  const merged = { ...current.mcpServers };
  for (const name of removeServerNames) delete merged[name];
  for (const [name, entry] of Object.entries(incoming.mcpServers)) {
    const existing = merged[name];
    if (existing && !sameEntry(existing, entry) && !force) {
      throw new Error(`Refusing to replace existing MCP server '${name}' without --force`);
    }
    merged[name] = entry;
  }
  return { ...current, mcpServers: merged };
}

export async function applyMcpConfiguration(
  path: string,
  incoming: McpConfiguration,
  force = false,
  removeServerNames: string[] = [],
) {
  let current: McpConfiguration = { mcpServers: {} };
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (
      typeof parsed !== "object"
      || parsed === null
      || !("mcpServers" in parsed)
      || typeof parsed.mcpServers !== "object"
      || parsed.mcpServers === null
      || Array.isArray(parsed.mcpServers)
    ) {
      throw new Error("Config must contain an mcpServers object");
    }
    current = parsed as McpConfiguration;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const merged = mergeMcpConfiguration(current, incoming, force, removeServerNames);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
  return merged;
}

export const CLIENT_REGISTRY: Record<PolicyClient, ClientInfo> = {
  antigravity: {
    id: "antigravity",
    name: "Antigravity (Google / Gemini)",
    description: "Configures .gemini/rules/roview.md and workspace MCP",
    defaultMcpConfigPath: (projectRoot) => join(projectRoot, ".gemini", "mcp.json"),
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    description: "Configures .cursor/mcp.json and .cursor/rules/roview.mdc",
    defaultMcpConfigPath: (projectRoot) => join(projectRoot, ".cursor", "mcp.json"),
  },
  claude: {
    id: "claude",
    name: "Claude Code / Claude Desktop",
    description: "Configures Claude Desktop mcp or .mcp.json and CLAUDE.roview.md",
    defaultMcpConfigPath: (projectRoot, userHome = osHomedir(), platform = process.platform) => {
      if (platform === "darwin") {
        return join(userHome, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      }
      if (platform === "win32") {
        const appData = process.env.APPDATA ?? join(userHome, "AppData", "Roaming");
        return join(appData, "Claude", "claude_desktop_config.json");
      }
      return join(projectRoot, ".mcp.json");
    },
  },
  windsurf: {
    id: "windsurf",
    name: "Windsurf (Codeium)",
    description: "Configures ~/.codeium/windsurf/mcp_config.json and .windsurfrules",
    defaultMcpConfigPath: (_projectRoot, userHome = osHomedir()) =>
      join(userHome, ".codeium", "windsurf", "mcp_config.json"),
  },
  cline: {
    id: "cline",
    name: "Cline (VS Code)",
    description: "Configures Cline MCP settings and .clinerules",
    defaultMcpConfigPath: (_projectRoot, userHome = osHomedir(), platform = process.platform) => {
      if (platform === "darwin") {
        return join(userHome, "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
      }
      if (platform === "win32") {
        const appData = process.env.APPDATA ?? join(userHome, "AppData", "Roaming");
        return join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
      }
      return undefined;
    },
  },
  roo: {
    id: "roo",
    name: "Roo Code (VS Code)",
    description: "Configures Roo Code MCP settings and .roomodes",
    defaultMcpConfigPath: (_projectRoot, userHome = osHomedir(), platform = process.platform) => {
      if (platform === "darwin") {
        return join(userHome, "Library", "Application Support", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
      }
      if (platform === "win32") {
        const appData = process.env.APPDATA ?? join(userHome, "AppData", "Roaming");
        return join(appData, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
      }
      return undefined;
    },
  },
  codex: {
    id: "codex",
    name: "Codex / OpenAI CLI",
    description: "Generates AGENTS.roview.md policy pack",
  },
  generic: {
    id: "generic",
    name: "Generic / Other Agent",
    description: "Generates ROVIEW_AGENT_POLICY.md",
  },
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export async function detectClients(
  projectRoot: string = process.cwd(),
  userHome: string = osHomedir(),
  platform: NodeJS.Platform = process.platform,
): Promise<PolicyClient[]> {
  const detected: PolicyClient[] = [];

  // Antigravity detection
  if (
    (await exists(join(projectRoot, ".gemini")))
    || (await exists(join(userHome, ".gemini")))
  ) {
    detected.push("antigravity");
  }

  // Cursor detection
  if (
    (await exists(join(projectRoot, ".cursor")))
    || (await exists(join(userHome, ".cursor")))
  ) {
    detected.push("cursor");
  }

  // Claude detection
  const claudeDesktopMac = join(userHome, "Library", "Application Support", "Claude");
  const claudeDesktopWin = process.env.APPDATA ? join(process.env.APPDATA, "Claude") : join(userHome, "AppData", "Roaming", "Claude");
  if (
    (await exists(join(userHome, ".claude.json")))
    || (await exists(join(projectRoot, "CLAUDE.md")))
    || (platform === "darwin" && (await exists(claudeDesktopMac)))
    || (platform === "win32" && (await exists(claudeDesktopWin)))
  ) {
    detected.push("claude");
  }

  // Windsurf detection
  if (
    (await exists(join(userHome, ".codeium", "windsurf")))
    || (await exists(join(projectRoot, ".windsurfrules")))
  ) {
    detected.push("windsurf");
  }

  // Cline detection
  const clineMac = join(userHome, "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev");
  if ((await exists(join(projectRoot, ".clinerules"))) || (platform === "darwin" && (await exists(clineMac)))) {
    detected.push("cline");
  }

  // Roo detection
  const rooMac = join(userHome, "Library", "Application Support", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline");
  if ((await exists(join(projectRoot, ".roomodes"))) || (platform === "darwin" && (await exists(rooMac)))) {
    detected.push("roo");
  }

  // Codex detection
  if (
    (await exists(join(projectRoot, "AGENTS.md")))
    || (await exists(join(projectRoot, "AGENTS.roview.md")))
  ) {
    detected.push("codex");
  }

  return detected;
}

export function resolveClientPaths(
  client: PolicyClient,
  projectRoot: string = process.cwd(),
  userHome: string = osHomedir(),
  platform: NodeJS.Platform = process.platform,
) {
  const info = CLIENT_REGISTRY[client];
  const mcpConfigPath = info.defaultMcpConfigPath
    ? info.defaultMcpConfigPath(projectRoot, userHome, platform)
    : undefined;
  const policyPath = join(projectRoot, policyRelativePath(client));

  return { mcpConfigPath, policyPath };
}

export async function findExistingToken(projectRoot: string): Promise<string | undefined> {
  const candidatePaths = [
    join(projectRoot, ".gemini", "mcp.json"),
    join(projectRoot, ".cursor", "mcp.json"),
    join(projectRoot, ".mcp.json"),
  ];
  for (const path of candidatePaths) {
    try {
      const data = JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
      const token = data?.mcpServers?.roview?.env?.ROVIEW_TOKEN
        || data?.mcpServers?.roview_safe?.env?.ROVIEW_TOKEN;
      if (typeof token === "string" && token.length > 0) {
        return token;
      }
    } catch {}
  }
  return undefined;
}


