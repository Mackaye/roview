import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createCompanion } from "../../companion/src/server.js";
import { RoviewClient } from "./client.js";
import { createRoviewMcpServer } from "./server.js";

const token = "mcp-protocol-test-token";

const waitForRecord = async (companion: ReturnType<typeof createCompanion>, proposalId: string, revision: number) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = companion.store.get(proposalId, revision);
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Proposal was not submitted through MCP");
};

describe("Roview MCP server", () => {
  it("advertises review tools and returns the human decision through MCP", async () => {
    const companion = createCompanion({ token });
    await new Promise<void>((resolve) => companion.server.listen(0, "127.0.0.1", resolve));
    const { port } = companion.server.address() as AddressInfo;
    const roviewClient = new RoviewClient({ baseUrl: `http://127.0.0.1:${port}`, token, pollIntervalMs: 5 });
    const server = createRoviewMcpServer({ client: roviewClient, openBrowser: () => {} });
    const client = new Client({ name: "roview-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["review_changes", "get_review"]);

      const decision = (async () => {
        const record = await waitForRecord(companion, "mcp-e2e", 1);
        await companion.store.decide("mcp-e2e", 1, {
          kind: "REQUEST_CHANGES",
          proposalDigest: record.digest,
          comments: [{ operationId: "create_folder", body: "Use a Configuration instance instead." }],
          decidedAt: "2026-08-17T11:00:00.000Z",
        });
      })();

      const result = await client.callTool({
        name: "review_changes",
        arguments: {
          proposalId: "mcp-e2e",
          revision: 1,
          title: "MCP protocol review",
          summary: "Verify end-to-end feedback delivery",
          plan: { format: "plain", content: "Create one reviewed folder" },
          operations: [{
            id: "create_folder",
            kind: "createInstance",
            target: { parent: { path: ["ReplicatedStorage"] }, className: "Folder", name: "McpReviewed" },
            preconditions: { nameCollision: "fail" },
          }],
          waitSeconds: 1,
        },
      });
      await decision;

      expect(result.isError).not.toBe(true);
      expect(result.content[0]).toMatchObject({ type: "text" });
      expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("Use a Configuration instance instead.");
    } finally {
      await Promise.all([client.close(), server.close()]);
      await new Promise<void>((resolve) => companion.server.close(() => resolve()));
    }
  });
});
