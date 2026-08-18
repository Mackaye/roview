import { fromJsonSchema, McpServer, type JsonSchemaType } from "@modelcontextprotocol/server";
import type { RoviewClient } from "./client.js";
import { registerRoviewTools, roviewInstructions } from "./server.js";
import { selectSafeStudioTools, type StudioToolSource } from "./studio-gateway.js";

interface SafeModeServerOptions {
  client: RoviewClient;
  studio: StudioToolSource;
  openBrowser?: (url: string) => void;
}

const gatewayInstructions = [
  roviewInstructions,
  "This Safe Mode server exposes only an allowlisted subset of Roblox Studio inspection and playtest tools.",
  "Persistent Studio mutations must be represented by a Roview proposal and applied by the Roview Studio plugin.",
].join(" ");

export async function createSafeModeMcpServer(options: SafeModeServerOptions) {
  const server = new McpServer(
    { name: "roview-safe", version: "0.1.0-draft.0" },
    { instructions: gatewayInstructions },
  );
  registerRoviewTools(server, {
    client: options.client,
    ...(options.openBrowser ? { openBrowser: options.openBrowser } : {}),
  });

  const studioTools = selectSafeStudioTools(await options.studio.listTools());
  for (const tool of studioTools) {
    server.registerTool(
      tool.name,
      {
        ...(tool.title ? { title: tool.title } : {}),
        description: `[Roblox Studio Safe Mode] ${tool.description ?? "Official Roblox Studio tool"}`,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      async (args, context) => options.studio.callTool(tool.name, args, context.mcpReq.signal),
    );
  }

  return server;
}
