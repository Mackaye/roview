import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createCompanion } from "./server.js";

const token = "test-token-with-enough-entropy-for-tests";
const activeServers: ReturnType<typeof createCompanion>["server"][] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startServer() {
  const companion = createCompanion({ token });
  activeServers.push(companion.server);
  await new Promise<void>((resolve) => companion.server.listen(0, "127.0.0.1", resolve));
  const { port } = companion.server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function requestWithHost(baseUrl: string, host: string) {
  const url = new URL("/healthz", baseUrl);
  return new Promise<number>((resolve, reject) => {
    const outgoing = request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { Host: host } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

describe("companion security boundary", () => {
  it("exposes loopback session discovery metadata", async () => {
    const baseUrl = await startServer();
    const sessionResponse = await fetch(`${baseUrl}/v1/session`);
    expect(sessionResponse.status).toBe(200);
    const sessionData = await sessionResponse.json() as Record<string, unknown>;
    expect(sessionData).toMatchObject({
      protocolVersion: "0.1",
      token,
      proposalCount: 0,
    });
    expect(typeof sessionData.port).toBe("number");
    expect(typeof sessionData.workspace).toBe("string");
  });

  it("exposes only minimal unauthenticated health", async () => {
    const baseUrl = await startServer();
    expect(await (await fetch(`${baseUrl}/healthz`)).json()).toEqual({ status: "ok" });
    expect((await fetch(`${baseUrl}/v1/proposals`)).status).toBe(401);
  });

  it("rejects non-loopback Host headers", async () => {
    const baseUrl = await startServer();
    expect(await requestWithHost(baseUrl, "malicious.example")).toBe(400);
  });

  it("rejects non-loopback and malformed Origin headers", async () => {
    const baseUrl = await startServer();
    const badOrigin = await fetch(`${baseUrl}/healthz`, { headers: { Origin: "http://malicious.example" } });
    expect(badOrigin.status).toBe(403);
    const nullOrigin = await fetch(`${baseUrl}/healthz`, { headers: { Origin: "null" } });
    expect(nullOrigin.status).toBe(403);
    const validOrigin = await fetch(`${baseUrl}/healthz`, { headers: { Origin: "http://127.0.0.1:3219" } });
    expect(validOrigin.status).toBe(200);
  });

  it("moves an approved digest through one preflight and apply attempt", async () => {
    const baseUrl = await startServer();
    const proposal = {
      protocolVersion: "0.1",
      proposalId: "test",
      revision: 1,
      title: "Test proposal",
      summary: "A small test proposal",
      createdAt: new Date().toISOString(),
      producer: { name: "test", version: "1" },
      plan: { format: "plain", content: "Create a folder" },
      operations: [{
        id: "op_1",
        kind: "createInstance",
        target: { parent: { path: ["ReplicatedStorage"] }, className: "Folder", name: "Demo" },
        preconditions: { nameCollision: "fail" },
      }],
    };
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const submitted = await fetch(`${baseUrl}/v1/proposals`, { method: "POST", headers, body: JSON.stringify(proposal) });
    const record = await submitted.json() as { digest: string };
    expect(submitted.status).toBe(201);
    const decision = await fetch(`${baseUrl}/v1/proposals/test/1/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "APPROVE", comments: [] }),
    });
    expect((await decision.json() as { status: string }).status).toBe("APPROVED");
    expect(record.digest).toMatch(/^[a-f0-9]{64}$/);

    const preflight = await fetch(`${baseUrl}/v1/plugin/proposals/test/1/preflight`, {
      method: "POST",
      headers,
      body: JSON.stringify({ proposalDigest: record.digest, errors: [] }),
    });
    expect((await preflight.json() as { status: string }).status).toBe("PREFLIGHT");

    const begin = await fetch(`${baseUrl}/v1/plugin/proposals/test/1/begin-apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ proposalDigest: record.digest }),
    });
    const applying = await begin.json() as { status: string; applyAttempt: { attemptId: string } };
    expect(applying.status).toBe("APPLYING");

    const duplicateBegin = await fetch(`${baseUrl}/v1/plugin/proposals/test/1/begin-apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ proposalDigest: record.digest }),
    });
    expect((await duplicateBegin.json() as { applyAttempt: { attemptId: string } }).applyAttempt.attemptId)
      .toBe(applying.applyAttempt.attemptId);

    const resultBody = {
      proposalDigest: record.digest,
      attemptId: applying.applyAttempt.attemptId,
      success: true,
      message: "Applied one operation as one Studio undo action.",
    };
    const result = await fetch(`${baseUrl}/v1/plugin/proposals/test/1/result`, {
      method: "POST",
      headers,
      body: JSON.stringify(resultBody),
    });
    expect((await result.json() as { status: string }).status).toBe("APPLIED");

    const duplicateResult = await fetch(`${baseUrl}/v1/plugin/proposals/test/1/result`, {
      method: "POST",
      headers,
      body: JSON.stringify(resultBody),
    });
    expect((await duplicateResult.json() as { status: string }).status).toBe("APPLIED");
  });

  it("supports doctor, cancellation, and explicit local data deletion", async () => {
    const baseUrl = await startServer();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const proposal = {
      protocolVersion: "0.1",
      proposalId: "cancel-me",
      revision: 1,
      title: "Cancel test",
      summary: "A proposal that will be cancelled",
      createdAt: new Date().toISOString(),
      producer: { name: "test", version: "1" },
      plan: { format: "plain", content: "Create a folder" },
      operations: [{
        id: "op_1",
        kind: "createInstance",
        target: { parent: { path: ["ReplicatedStorage"] }, className: "Folder", name: "Demo" },
        preconditions: { nameCollision: "fail" },
      }],
    };
    await fetch(`${baseUrl}/v1/proposals`, { method: "POST", headers, body: JSON.stringify(proposal) });
    const doctor = await fetch(`${baseUrl}/v1/doctor`, { headers });
    expect(await doctor.json()).toMatchObject({ authenticated: true, loopback: true, proposalCount: 1 });

    const cancelled = await fetch(`${baseUrl}/v1/proposals/cancel-me/1/cancel`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect((await cancelled.json() as { status: string }).status).toBe("CANCELLED");

    const deleted = await fetch(`${baseUrl}/v1/data`, { method: "DELETE", headers });
    expect(await deleted.json()).toEqual({ deleted: 1 });
  });

  it("pairs once, serves cursor inbox changes, rotates tokens, and protects draft generations", async () => {
	const pairingCode = "one-use-pairing-code-for-tests";
	const companion = createCompanion({ token, pairingCode });
	activeServers.push(companion.server);
	await new Promise<void>((resolve) => companion.server.listen(0, "127.0.0.1", resolve));
	const { port } = companion.server.address() as AddressInfo;
	const baseUrl = `http://127.0.0.1:${port}`;
	const paired = await fetch(`${baseUrl}/v1/pair`, {
	  method: "POST",
	  headers: { "Content-Type": "application/json" },
	  body: JSON.stringify({ pairingCode }),
	});
	expect(await paired.json()).toMatchObject({ token, protocolVersion: "0.1" });
	expect((await fetch(`${baseUrl}/v1/pair`, {
	  method: "POST",
	  headers: { "Content-Type": "application/json" },
	  body: JSON.stringify({ pairingCode }),
	})).status).toBe(409);

	const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
	const initialInbox = await fetch(`${baseUrl}/v1/plugin/inbox`, { headers });
	expect(await initialInbox.json()).toMatchObject({ cursor: 0, changed: true, proposals: [] });
	const proposal = {
	  protocolVersion: "0.1",
	  proposalId: "draft-and-cursor",
	  revision: 1,
	  title: "Draft and cursor",
	  summary: "Tests durable review state",
	  createdAt: "2026-08-17T14:00:00.000Z",
	  producer: { name: "test", version: "1" },
	  plan: { format: "plain", content: "Create a folder" },
	  operations: [{
	    id: "create",
	    kind: "createInstance",
	    target: { parent: { path: ["ReplicatedStorage"] }, className: "Folder", name: "DraftCursor" },
	    preconditions: { nameCollision: "fail" },
	  }],
	};
	const submitted = await fetch(`${baseUrl}/v1/proposals`, {
	  method: "POST", headers, body: JSON.stringify(proposal),
	});
	const record = await submitted.json() as { digest: string };
	const changedInbox = await fetch(`${baseUrl}/v1/plugin/inbox?after=0&waitMs=0`, { headers });
	expect(await changedInbox.json()).toMatchObject({ cursor: 1, changed: true });

	const draftBody = {
	  proposalDigest: record.digest,
	  expectedGeneration: 0,
	  comments: [{ body: "Please verify", operationId: "create" }],
	  globalComment: "Draft note",
	  viewedItemIds: ["plan"],
	};
	const draft = await fetch(`${baseUrl}/v1/proposals/draft-and-cursor/1/draft`, {
	  method: "PUT", headers, body: JSON.stringify(draftBody),
	});
	expect(await draft.json()).toMatchObject({ draft: { generation: 1, globalComment: "Draft note" } });
	const staleDraft = await fetch(`${baseUrl}/v1/proposals/draft-and-cursor/1/draft`, {
	  method: "PUT", headers, body: JSON.stringify(draftBody),
	});
	expect(staleDraft.status).toBe(400);

	const rotated = await fetch(`${baseUrl}/v1/token/rotate`, { method: "POST", headers, body: "{}" });
	const rotatedBody = await rotated.json() as { token: string };
	expect(rotatedBody.token).not.toBe(token);
	expect((await fetch(`${baseUrl}/v1/proposals`, { headers })).status).toBe(401);
  });
});
