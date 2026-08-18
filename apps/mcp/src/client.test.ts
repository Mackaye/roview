import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createCompanion } from "../../companion/src/server.js";
import { RoviewClient } from "./client.js";

const token = "mcp-test-token";
const activeServers: ReturnType<typeof createCompanion>["server"][] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function harness() {
  const companion = createCompanion({ token });
  activeServers.push(companion.server);
  await new Promise<void>((resolve) => companion.server.listen(0, "127.0.0.1", resolve));
  const { port } = companion.server.address() as AddressInfo;
  const client = new RoviewClient({ baseUrl: `http://127.0.0.1:${port}`, token, pollIntervalMs: 5 });
  return { client, companion };
}

const proposal = {
  protocolVersion: "0.1" as const,
  proposalId: "mcp-review",
  revision: 1,
  title: "MCP review",
  summary: "Review one safe folder creation",
  createdAt: "2026-08-17T10:00:00.000Z",
  producer: { name: "roview-mcp", version: "test" },
  plan: { format: "plain" as const, content: "Create a reviewed folder" },
  operations: [{
    id: "create_folder",
    kind: "createInstance" as const,
    target: { parent: { path: ["ReplicatedStorage"] }, className: "Folder", name: "Reviewed" },
    preconditions: { nameCollision: "fail" as const },
  }],
};

describe("Roview MCP companion client", () => {
  it("submits and waits until human feedback is recorded", async () => {
    const { client, companion } = await harness();
    const submitted = await client.submit(proposal);
    const waiting = client.waitForDecision(proposal.proposalId, proposal.revision, { timeoutSeconds: 1 });
    await companion.store.decide(proposal.proposalId, proposal.revision, {
      kind: "REQUEST_CHANGES",
      proposalDigest: submitted.digest,
      comments: [{ operationId: "create_folder", body: "Use ServerStorage instead." }],
      decidedAt: "2026-08-17T10:01:00.000Z",
    });
    const result = await waiting;
    expect(result.timedOut).toBe(false);
    expect(result.record.status).toBe("CHANGES_REQUESTED");
    expect(result.record.decision?.comments[0]?.body).toBe("Use ServerStorage instead.");
  });

  it("returns a durable pending record when its wait window expires", async () => {
    const { client } = await harness();
    await client.submit(proposal);
    const result = await client.waitForDecision(proposal.proposalId, proposal.revision, { timeoutSeconds: 0.01 });
    expect(result.timedOut).toBe(true);
    expect(result.record.status).toBe("READY_FOR_REVIEW");
  });

  it("refuses non-loopback companion URLs", () => {
    expect(() => new RoviewClient({ baseUrl: "https://example.com", token })).toThrow("loopback companion");
  });
});
