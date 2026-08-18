import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { RoviewClient } from "./client.js";
import { createSafeModeMcpServer } from "./safe-server.js";
import { RobloxStudioToolSource } from "./studio-gateway.js";

let studio: RobloxStudioToolSource | undefined;

try {
  const client = RoviewClient.fromEnvironment();
  studio = await RobloxStudioToolSource.connect();
  const server = await createSafeModeMcpServer({ client, studio });
  serveStdio(() => server, {
    onerror: (error) => console.error(`[roview-safe] ${error.message}`),
  });
  console.error("Roview Safe Mode ready with allowlisted Roblox Studio tools");
} catch (error) {
  console.error(`[roview-safe] ${error instanceof Error ? error.message : "Failed to start"}`);
  await studio?.close().catch(() => {});
  process.exitCode = 1;
}
