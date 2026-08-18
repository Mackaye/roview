import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import { InMemoryTransport, type Tool } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { RoviewClient } from "./client.js";
import { createSafeModeMcpServer } from "./safe-server.js";
import type { StudioToolSource } from "./studio-gateway.js";

const studioTool = (name: string): Tool => ({
  name,
  description: `${name} description`,
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    additionalProperties: false,
  },
});

class FakeStudioToolSource implements StudioToolSource {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(private readonly tools: Tool[]) {}

  async listTools() {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    this.calls.push({ name, args });
    return { content: [{ type: "text", text: `forwarded ${name}` }] };
  }

  async close() {}
}

describe("Roview Safe Mode MCP server", () => {
  it("combines Roview review tools with only allowlisted official Studio tools", async () => {
    const studio = new FakeStudioToolSource([
      studioTool("script_read"),
      studioTool("search_game_tree"),
      studioTool("start_stop_play"),
      studioTool("multi_edit"),
      studioTool("execute_luau"),
      studioTool("future_mutation"),
    ]);
    const roviewClient = new RoviewClient({
      baseUrl: "http://127.0.0.1:3219",
      token: "safe-mode-test-token",
    });
    const server = await createSafeModeMcpServer({ client: roviewClient, studio, openBrowser: () => {} });
    const client = new Client({ name: "safe-mode-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        "review_changes",
        "get_review",
        "script_read",
        "search_game_tree",
        "start_stop_play",
      ]);

      const result = await client.callTool({ name: "script_read", arguments: { path: "game.ServerScriptService.Main" } });
      expect(result.content[0]).toMatchObject({ type: "text", text: "forwarded script_read" });
      expect(studio.calls).toEqual([{
        name: "script_read",
        args: { path: "game.ServerScriptService.Main" },
      }]);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
