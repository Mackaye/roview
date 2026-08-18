import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseProposal,
  proposalDigest,
  ProtocolValidationError,
  type DecisionKind,
  type ReviewComment,
  type ReviewDecision,
} from "@roview/protocol";
import { ProposalStore } from "./store.js";

const DEFAULT_PORT = 3219;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

interface CompanionOptions {
  token?: string;
  pairingCode?: string;
  store?: ProposalStore;
  workspaceName?: string;
}

const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
};

const isAllowedHost = (host: string | undefined) => {
  if (!host) return false;
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
};

const tokenMatches = (received: string | undefined, expected: string) => {
  if (!received?.startsWith("Bearer ")) return false;
  const providedDigest = createHash("sha256").update(received.slice(7)).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
};

const secretMatches = (received: string, expected: string) => {
  const providedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
};

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body exceeds 10 MB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

const validateDecision = (value: unknown, digest: string, operationIds?: Set<string>): ReviewDecision => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Decision must be an object");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["kind", "comments"].includes(key))) throw new Error("Decision contains unsupported fields");
  const kinds: DecisionKind[] = ["APPROVE", "REJECT", "REQUEST_CHANGES"];
  if (!kinds.includes(record.kind as DecisionKind)) throw new Error("Decision kind is invalid");
  if (!Array.isArray(record.comments)) throw new Error("Decision comments must be an array");
  const comments: ReviewComment[] = record.comments.map((comment) => {
    if (typeof comment !== "object" || comment === null || Array.isArray(comment)) throw new Error("Comment must be an object");
    const candidate = comment as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => !["body", "operationId", "line", "side"].includes(key))) {
      throw new Error("Comment contains unsupported fields");
    }
    if (typeof candidate.body !== "string" || candidate.body.trim().length === 0) throw new Error("Comment body is required");
    if (candidate.operationId !== undefined && typeof candidate.operationId !== "string") throw new Error("Comment operationId is invalid");
    if (typeof candidate.operationId === "string" && operationIds && !operationIds.has(candidate.operationId)) {
      throw new Error("Comment operationId does not exist in this proposal");
    }
    if (candidate.line !== undefined && (!Number.isInteger(candidate.line) || (candidate.line as number) < 1)) throw new Error("Comment line is invalid");
    if (candidate.side !== undefined && candidate.side !== "before" && candidate.side !== "after") throw new Error("Comment side is invalid");
    if ((candidate.line === undefined) !== (candidate.side === undefined)) throw new Error("Comment line and side must be supplied together");
    return {
      body: candidate.body.trim(),
      ...(candidate.operationId === undefined ? {} : { operationId: candidate.operationId }),
      ...(candidate.line === undefined ? {} : { line: candidate.line as number }),
      ...(candidate.side === undefined ? {} : { side: candidate.side }),
    };
  });
  return {
    kind: record.kind as DecisionKind,
    proposalDigest: digest,
    comments,
    decidedAt: new Date().toISOString(),
  };
};

const validateDraft = (value: unknown, proposalId: string, revision: number, digest: string, operationIds: Set<string>) => {
  const record = requestRecord(value);
  if (record.proposalDigest !== digest) throw new Error("Draft digest does not match the proposal");
  if (!Number.isInteger(record.expectedGeneration) || (record.expectedGeneration as number) < 0) {
    throw new Error("expectedGeneration must be a non-negative integer");
  }
  if (typeof record.globalComment !== "string") throw new Error("globalComment must be a string");
  if (!Array.isArray(record.viewedItemIds) || record.viewedItemIds.some((id) => typeof id !== "string")) {
    throw new Error("viewedItemIds must be an array of strings");
  }
  const decision = validateDecision({ kind: "APPROVE", comments: record.comments }, digest, operationIds);
  return {
    expectedGeneration: record.expectedGeneration as number,
    draft: {
      proposalId,
      revision,
      proposalDigest: digest,
      comments: decision.comments,
      globalComment: record.globalComment,
      viewedItemIds: [...new Set(record.viewedItemIds as string[])],
    },
  };
};

const requestRecord = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Request body must be an object");
  return value as Record<string, unknown>;
};

const requiredDigest = (value: Record<string, unknown>) => {
  if (typeof value.proposalDigest !== "string") throw new Error("proposalDigest is required");
  return value.proposalDigest;
};

async function serveStatic(pathname: string, response: ServerResponse) {
  const asset = pathname === "/" || pathname === "/review" ? "index.html" : pathname.slice(1);
  if (!/^[a-zA-Z0-9._/-]+$/.test(asset) || asset.includes("..")) {
    json(response, 404, { error: "Not found" });
    return;
  }
  try {
    const body = await readFile(join(publicDirectory, asset));
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes[extname(asset)] ?? "application/octet-stream",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    response.end(body);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

export function createCompanion(options: CompanionOptions = {}) {
  let token = options.token ?? randomBytes(32).toString("base64url");
  const pairingCode = options.pairingCode ?? randomBytes(18).toString("base64url");
  const workspaceName = options.workspaceName ?? basename(process.cwd());
  let pairingConsumed = false;
  let failedPairingAttempts = 0;
  const store = options.store ?? new ProposalStore();
  const server = createServer(async (request, response) => {
    try {
      if (!isAllowedHost(request.headers.host)) {
        json(response, 400, { error: "Roview accepts loopback hosts only" });
        return;
      }
      const origin = request.headers.origin;
      if (origin) {
        try {
          const originUrl = new URL(origin);
          if (!isAllowedHost(originUrl.host)) {
            json(response, 403, { error: "Origin is not allowed" });
            return;
          }
        } catch {
          json(response, 403, { error: "Origin is not allowed" });
          return;
        }
      }

      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      if (url.pathname === "/healthz" && request.method === "GET") {
        json(response, 200, { status: "ok" });
        return;
      }
      if (url.pathname === "/v1/session" && request.method === "GET") {
        const address = server.address();
        const port = typeof address === "object" && address !== null ? address.port : DEFAULT_PORT;
        json(response, 200, {
          protocolVersion: "0.1",
          workspace: workspaceName,
          cwd: process.cwd(),
          port,
          token,
          pid: process.pid,
          proposalCount: store.list().length,
        });
        return;
      }
      if (url.pathname === "/v1/pair" && request.method === "POST") {
        if (pairingConsumed || failedPairingAttempts >= 5) {
          json(response, 409, { error: "Pairing is unavailable; restart the companion to create a new pairing code" });
          return;
        }
        const body = requestRecord(await readJson(request));
        if (typeof body.pairingCode !== "string" || !secretMatches(body.pairingCode, pairingCode)) {
          failedPairingAttempts += 1;
          json(response, 401, { error: "Pairing code is invalid" });
          return;
        }
        pairingConsumed = true;
        json(response, 200, { token, protocolVersion: "0.1" });
        return;
      }
      if (!url.pathname.startsWith("/v1/")) {
        await serveStatic(url.pathname, response);
        return;
      }
      if (!tokenMatches(request.headers.authorization, token)) {
        json(response, 401, { error: "A valid Roview session token is required" });
        return;
      }

      if (url.pathname === "/v1/proposals" && request.method === "GET") {
        const afterParameter = url.searchParams.get("after");
        const after = afterParameter === null ? undefined : Number(afterParameter);
        if (after !== undefined && (!Number.isInteger(after) || after < 0)) throw new Error("after must be a non-negative cursor");
        const waitMs = Math.min(Math.max(Number(url.searchParams.get("waitMs") ?? 0), 0), 25_000);
        if (after !== undefined && after >= store.cursor && waitMs > 0) await store.waitForChange(after, waitMs);
        const changed = after === undefined || after < store.cursor;
        json(response, 200, {
          cursor: store.cursor,
          changed,
          proposals: store.list(),
        });
        return;
      }

      if (url.pathname === "/v1/plugin/inbox" && request.method === "GET") {
        const afterParameter = url.searchParams.get("after");
        const after = afterParameter === null ? undefined : Number(afterParameter);
        if (after !== undefined && (!Number.isInteger(after) || after < 0)) throw new Error("after must be a non-negative cursor");
        const waitMs = Math.min(Math.max(Number(url.searchParams.get("waitMs") ?? 0), 0), 25_000);
        if (after !== undefined && after >= store.cursor && waitMs > 0) await store.waitForChange(after, waitMs);
        const changed = after === undefined || after < store.cursor;
        json(response, 200, {
          cursor: store.cursor,
          changed,
          ...(changed ? { proposals: store.list() } : {}),
          protocolVersion: "0.1",
        });
        return;
      }
      if (url.pathname === "/v1/proposals" && request.method === "POST") {
        const proposal = parseProposal(await readJson(request));
        const record = await store.put({ proposal, digest: proposalDigest(proposal), status: "READY_FOR_REVIEW" });
        json(response, 201, record);
        return;
      }
      if (url.pathname === "/v1/doctor" && request.method === "GET") {
        json(response, 200, {
          authenticated: true,
          loopback: true,
          proposalCount: store.list().length,
          protocolVersion: "0.1",
        });
        return;
      }
      if (url.pathname === "/v1/data" && request.method === "DELETE") {
        const deleted = await store.deleteAll();
        json(response, 200, { deleted });
        return;
      }
      if (url.pathname === "/v1/token/rotate" && request.method === "POST") {
        token = randomBytes(32).toString("base64url");
        json(response, 200, { token, rotatedAt: new Date().toISOString() });
        return;
      }

      const proposalMatch = url.pathname.match(/^\/v1\/proposals\/([^/]+)\/(\d+)$/);
      if (proposalMatch && request.method === "GET") {
        const record = store.get(decodeURIComponent(proposalMatch[1] ?? ""), Number(proposalMatch[2]));
        json(response, record ? 200 : 404, record ?? { error: "Proposal not found" });
        return;
      }
      const decisionMatch = url.pathname.match(/^\/v1\/proposals\/([^/]+)\/(\d+)\/decision$/);
      if (decisionMatch && request.method === "POST") {
        const proposalId = decodeURIComponent(decisionMatch[1] ?? "");
        const revision = Number(decisionMatch[2]);
        const current = store.get(proposalId, revision);
        if (!current) {
          json(response, 404, { error: "Proposal not found" });
          return;
        }
        const operationIds = new Set(current.proposal.operations.map((operation) => operation.id));
        const decided = await store.decide(proposalId, revision, validateDecision(await readJson(request), current.digest, operationIds));
        json(response, 200, decided);
        return;
      }
      const reviewedMatch = url.pathname.match(/^\/v1\/proposals\/([^/]+)\/(\d+)\/reviewed$/);
      if (reviewedMatch && request.method === "POST") {
        json(response, 200, await store.markReviewed(
          decodeURIComponent(reviewedMatch[1] ?? ""),
          Number(reviewedMatch[2]),
        ));
        return;
      }
      const draftMatch = url.pathname.match(/^\/v1\/proposals\/([^/]+)\/(\d+)\/draft$/);
      if (draftMatch) {
        const proposalId = decodeURIComponent(draftMatch[1] ?? "");
        const revision = Number(draftMatch[2]);
        const current = store.get(proposalId, revision);
        if (!current) {
          json(response, 404, { error: "Proposal not found" });
          return;
        }
        if (request.method === "GET") {
          json(response, 200, { draft: store.getDraft(proposalId, revision) ?? null });
          return;
        }
        if (request.method === "PUT") {
          const operationIds = new Set(current.proposal.operations.map((operation) => operation.id));
          const { draft, expectedGeneration } = validateDraft(await readJson(request), proposalId, revision, current.digest, operationIds);
          json(response, 200, { draft: await store.saveDraft(draft, expectedGeneration) });
          return;
        }
        if (request.method === "DELETE") {
          const body = requestRecord(await readJson(request));
          const digest = requiredDigest(body);
          if (!Number.isInteger(body.expectedGeneration) || (body.expectedGeneration as number) < 0) {
            throw new Error("expectedGeneration must be a non-negative integer");
          }
          json(response, 200, await store.deleteDraft(proposalId, revision, digest, body.expectedGeneration as number));
          return;
        }
      }
      const cancelMatch = url.pathname.match(/^\/v1\/proposals\/([^/]+)\/(\d+)\/cancel$/);
      if (cancelMatch && request.method === "POST") {
        const record = await store.cancel(
          decodeURIComponent(cancelMatch[1] ?? ""),
          Number(cancelMatch[2]),
        );
        json(response, 200, record);
        return;
      }

      const pluginMatch = url.pathname.match(/^\/v1\/plugin\/proposals\/([^/]+)\/(\d+)\/(preflight|begin-apply|result)$/);
      if (pluginMatch && request.method === "POST") {
        const proposalId = decodeURIComponent(pluginMatch[1] ?? "");
        const revision = Number(pluginMatch[2]);
        const action = pluginMatch[3];
        const body = requestRecord(await readJson(request));
        const digest = requiredDigest(body);
        if (action === "preflight") {
          if (!Array.isArray(body.errors) || body.errors.some((issue) => typeof issue !== "string")) {
            throw new Error("errors must be an array of strings");
          }
          const record = await store.reportPreflight(proposalId, revision, {
            proposalDigest: digest,
            checkedAt: new Date().toISOString(),
            errors: body.errors,
            ...(Array.isArray(body.issues) ? { issues: body.issues as any } : {}),
          });
          json(response, 200, record);
          return;
        }
        if (action === "begin-apply") {
          const record = await store.beginApply(proposalId, revision, {
            attemptId: randomUUID(),
            proposalDigest: digest,
            startedAt: new Date().toISOString(),
          });
          json(response, 200, record);
          return;
        }
        if (typeof body.attemptId !== "string") throw new Error("attemptId is required");
        if (typeof body.success !== "boolean") throw new Error("success must be a boolean");
        if (typeof body.message !== "string" || body.message.length === 0) throw new Error("message is required");
        const record = await store.finishApply(proposalId, revision, {
          attemptId: body.attemptId,
          proposalDigest: digest,
          success: body.success,
          message: body.message,
          completedAt: new Date().toISOString(),
        });
        json(response, 200, record);
        return;
      }

      json(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof ProtocolValidationError) json(response, 422, { error: error.message, issues: error.issues });
      else json(response, 400, { error: error instanceof Error ? error.message : "Invalid request" });
    }
  });

  return { server, store, get token() { return token; }, pairingCode };
}

async function start() {
  const preferredPort = Number(process.env.ROVIEW_PORT ?? DEFAULT_PORT);
  const configuredToken = process.env.ROVIEW_TOKEN;
  const retentionDays = Number(process.env.ROVIEW_RETENTION_DAYS ?? 30);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error("ROVIEW_RETENTION_DAYS must be a positive integer");
  const persistencePath = resolve(process.env.ROVIEW_DATA_PATH ?? ".roview/proposals.json");
  const dataDirectory = dirname(persistencePath);
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const lockPath = join(dataDirectory, "companion.lock");
  const discoveryPath = join(dataDirectory, "discovery.json");
  let lockHandle;
  try {
    lockHandle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let stale = false;
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown };
      if (typeof lock.pid !== "number") stale = true;
      else {
        try {
          process.kill(lock.pid, 0);
        } catch (processError) {
          stale = (processError as NodeJS.ErrnoException).code === "ESRCH";
        }
      }
    } catch {
      stale = true;
    }
    if (!stale) throw new Error(`Another Roview companion owns ${lockPath}`);
    await unlink(lockPath);
    lockHandle = await open(lockPath, "wx", 0o600);
  }
  const startedAt = new Date().toISOString();
  await lockHandle.writeFile(JSON.stringify({ pid: process.pid, startedAt }), "utf8");
  const store = await ProposalStore.open(persistencePath, retentionDays);
  const companion = createCompanion({ ...(configuredToken ? { token: configuredToken } : {}), store });
  if (process.env.ROVIEW_DEMO_FIXTURE === "1") {
    const fixtureUrl = new URL("../../../packages/fixtures/proposals/daily-reward.json", import.meta.url);
    const proposal = parseProposal(JSON.parse(await readFile(fixtureUrl, "utf8")));
    if (!companion.store.get(proposal.proposalId, proposal.revision)) {
      await companion.store.put({ proposal, digest: proposalDigest(proposal), status: "READY_FOR_REVIEW" });
    }
  }
  const listen = (port: number) => new Promise<number>((resolveListen, rejectListen) => {
    const onError = (error: Error) => rejectListen(error);
    companion.server.once("error", onError);
    companion.server.listen(port, "127.0.0.1", () => {
      companion.server.off("error", onError);
      const address = companion.server.address();
      if (!address || typeof address === "string") rejectListen(new Error("Companion did not expose a TCP port"));
      else resolveListen(address.port);
    });
  });
  let port: number;
  try {
    port = await listen(preferredPort);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || process.env.ROVIEW_PORT) throw error;
    port = await listen(0);
    console.warn(`Preferred port ${preferredPort} was busy; using loopback port ${port}.`);
  }
  await writeFile(discoveryPath, JSON.stringify({
    pid: process.pid,
    port,
    protocolVersion: "0.1",
    startedAt,
  }, null, 2), { encoding: "utf8", mode: 0o600 });
  const cleanup = async () => {
    await lockHandle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
    await unlink(discoveryPath).catch(() => {});
  };
  companion.server.once("close", () => void cleanup());
  console.log(`Roview companion: http://127.0.0.1:${port}/review?token=${companion.token}`);
  console.log(`Studio pairing value (one use): http://127.0.0.1:${port}|${companion.pairingCode}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void start();
