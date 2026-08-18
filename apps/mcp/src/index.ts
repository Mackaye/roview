import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { RoviewClient } from "./client.js";
import { createRoviewMcpServer } from "./server.js";

async function main() {
  try {
    const client = await RoviewClient.fromEnvironmentOrDiscovery();
    serveStdio(() => createRoviewMcpServer({ client }), {
      onerror: (error) => console.error(`[roview-mcp] ${error.message}`),
    });
    console.error("Roview MCP server ready on stdio");
  } catch (error) {
    console.error(`[roview-mcp] ${error instanceof Error ? error.message : "Failed to start"}`);
    process.exitCode = 1;
  }
}

main();
