import { readFile } from "node:fs/promises";

const DEFAULT_URL = "http://127.0.0.1:3219";

function usage(): never {
  console.error(`Usage:
  pnpm cli submit <proposal.json>
  pnpm cli list
  pnpm cli status <proposal-id> <revision>
  pnpm cli cancel <proposal-id> <revision>
  pnpm cli doctor
  pnpm cli data-delete --yes

Set ROVIEW_TOKEN to the session token printed by the companion.`);
  process.exit(1);
}

function configuration() {
  const token = process.env.ROVIEW_TOKEN;
  if (!token) throw new Error("ROVIEW_TOKEN is required");
  const baseUrl = new URL(process.env.ROVIEW_URL ?? DEFAULT_URL);
  if (!["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname)) {
    throw new Error("The prototype CLI connects to loopback companions only");
  }
  return { token, baseUrl: baseUrl.toString().replace(/\/$/, "") };
}

async function request(path: string, init?: RequestInit) {
  const { token, baseUrl } = configuration();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Companion returned HTTP ${response.status}`);
  return body;
}

function summary(record: Record<string, unknown>) {
  const proposal = record.proposal as Record<string, unknown>;
  return `${proposal.proposalId} r${proposal.revision}  ${record.status}  ${proposal.title}`;
}

async function run() {
  const [, , command, ...args] = process.argv;
  if (!command) usage();

  if (command === "submit") {
    const file = args[0];
    if (!file) usage();
    const raw = await readFile(file, "utf8");
    const record = await request("/v1/proposals", { method: "POST", body: raw });
    console.log(summary(record));
    return;
  }

  if (command === "list") {
    const body = await request("/v1/proposals");
    const proposals = body.proposals as Record<string, unknown>[];
    if (proposals.length === 0) console.log("No proposals.");
    else for (const record of proposals) console.log(summary(record));
    return;
  }

  if (command === "status") {
    const [proposalId, revisionText] = args;
    const revision = Number(revisionText);
    if (!proposalId || !Number.isInteger(revision) || revision < 1) usage();
    const record = await request(`/v1/proposals/${encodeURIComponent(proposalId)}/${revision}`);
    console.log(summary(record));
    const result = record.applyResult as Record<string, unknown> | undefined;
    if (result) console.log(`  ${result.success ? "success" : "failed"}: ${result.message}`);
    return;
  }

  if (command === "cancel") {
    const [proposalId, revisionText] = args;
    const revision = Number(revisionText);
    if (!proposalId || !Number.isInteger(revision) || revision < 1) usage();
    const record = await request(
      `/v1/proposals/${encodeURIComponent(proposalId)}/${revision}/cancel`,
      { method: "POST", body: "{}" },
    );
    console.log(summary(record));
    return;
  }

  if (command === "doctor") {
    const report = await request("/v1/doctor");
    console.log("Companion reachable");
    console.log(`  authenticated: ${String(report.authenticated)}`);
    console.log(`  loopback only: ${String(report.loopback)}`);
    console.log(`  protocol: ${String(report.protocolVersion)}`);
    console.log(`  proposals: ${String(report.proposalCount)}`);
    return;
  }

  if (command === "data-delete") {
    if (args[0] !== "--yes") {
      throw new Error("Refusing to delete local review data without --yes");
    }
    const result = await request("/v1/data", { method: "DELETE" });
    console.log(`Deleted ${String(result.deleted)} local proposal record(s).`);
    return;
  }

  usage();
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Roview CLI failed");
  process.exitCode = 1;
}
