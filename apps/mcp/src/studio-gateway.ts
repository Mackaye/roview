import {
  Client,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";

export const SAFE_STUDIO_TOOL_NAMES = [
  "script_read",
  "script_search",
  "script_grep",
  "search_game_tree",
  "inspect_instance",
  "get_studio_state",
  "get_console_output",
  "screen_capture",
  "http_get",
  "skill",
  "list_roblox_studios",
  "set_active_studio",
  "start_stop_play",
  "character_navigation",
  "user_keyboard_input",
  "user_mouse_input",
] as const;

const safeStudioToolNames = new Set<string>(SAFE_STUDIO_TOOL_NAMES);

export interface StudioToolSource {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult>;
  close(): Promise<void>;
}

export const selectSafeStudioTools = (tools: Tool[]) => tools.filter((tool) => safeStudioToolNames.has(tool.name));

interface StudioCommand {
  command: string;
  args: string[];
}

export function resolveStudioMcpCommand(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): StudioCommand {
  const commandOverride = environment.ROVIEW_STUDIO_MCP_COMMAND;
  if (commandOverride) {
    const rawArgs = environment.ROVIEW_STUDIO_MCP_ARGS;
    const args = rawArgs
      ? JSON.parse(rawArgs) as unknown
      : [];
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
      throw new Error("ROVIEW_STUDIO_MCP_ARGS must be a JSON array of strings");
    }
    return { command: commandOverride, args };
  }

  if (platform === "darwin") {
    return {
      command: "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP",
      args: [],
    };
  }
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    if (!localAppData) throw new Error("LOCALAPPDATA is required to locate Roblox Studio MCP on Windows");
    return {
      command: "cmd.exe",
      args: ["/c", `${localAppData}\\Roblox\\mcp.bat`],
    };
  }
  throw new Error(
    "Roblox Studio MCP auto-detection currently supports macOS and Windows. Set ROVIEW_STUDIO_MCP_COMMAND explicitly.",
  );
}

export class RobloxStudioToolSource implements StudioToolSource {
  private constructor(private readonly client: Client) {}

  static async connect(command = resolveStudioMcpCommand()) {
    const client = new Client({ name: "roview-safe-gateway", version: "0.1.0-draft.0" });
    const transport = new StdioClientTransport({
      command: command.command,
      args: command.args,
      env: getDefaultEnvironment(),
      stderr: "inherit",
    });
    await client.connect(transport);
    await client.listTools();
    return new RobloxStudioToolSource(client);
  }

  async listTools() {
    return (await this.client.listTools()).tools;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    return this.client.callTool(
      { name, arguments: args },
      { ...(signal ? { signal } : {}), maxTotalTimeout: 15 * 60 * 1_000 },
    );
  }

  async close() {
    await this.client.close();
  }
}
