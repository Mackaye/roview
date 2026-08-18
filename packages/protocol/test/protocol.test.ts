import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseProposal, proposalDigest, ProtocolValidationError, summarizeProposalRisk } from "../src/index.js";

const fixtureUrl = new URL("../../fixtures/proposals/daily-reward.json", import.meta.url);
const fixtureDirectoryUrl = new URL("../../fixtures/proposals/", import.meta.url);
const manifestUrl = new URL("../../fixtures/manifest.json", import.meta.url);

describe("proposal protocol", () => {
  it("accepts the representative mixed proposal", async () => {
    const proposal = parseProposal(JSON.parse(await readFile(fixtureUrl, "utf8")));
    expect(proposal.operations.length).toBeGreaterThanOrEqual(3);
    expect(proposalDigest(proposal)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects duplicate operation IDs", async () => {
    const raw = JSON.parse(await readFile(fixtureUrl, "utf8"));
    raw.operations[1].id = raw.operations[0].id;
    expect(() => parseProposal(raw)).toThrow(ProtocolValidationError);
  });

  it("rejects a before-source that does not match its reviewed hash", async () => {
    const raw = JSON.parse(await readFile(fixtureUrl, "utf8"));
    const scriptOp = raw.operations.find((op: any) => op.kind === "replaceScriptSource");
    scriptOp.before.source += "-- changed";
    expect(() => parseProposal(raw)).toThrow(/does not match sourceSha256/);
  });

  it("produces a stable digest independent of object key insertion order", () => {
    expect(proposalDigest({ b: 2, a: 1 })).toBe(proposalDigest({ a: 1, b: 2 }));
    expect(proposalDigest({ b: 2, a: 1 })).toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
  });

  it("matches the representative fixture acceptance corpus", async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as Record<
      string,
      { valid: boolean; errorIncludes?: string }
    >;
    expect(Object.keys(manifest).length).toBeGreaterThanOrEqual(10);
    for (const [file, expectation] of Object.entries(manifest)) {
      const raw = JSON.parse(await readFile(new URL(file, fixtureDirectoryUrl), "utf8"));
      if (expectation.valid) {
        expect(() => parseProposal(raw), file).not.toThrow();
      } else {
        expect(() => parseProposal(raw), file).toThrow(expectation.errorIncludes);
      }
    }
  });

  it("accepts the 20-operation Phase 1 gate fixture", async () => {
    const raw = JSON.parse(await readFile(new URL("twenty-operation.json", fixtureDirectoryUrl), "utf8"));
    expect(parseProposal(raw).operations).toHaveLength(20);
  });

  it("rejects unknown fields and ambiguous empty optional arrays", async () => {
    const raw = JSON.parse(await readFile(fixtureUrl, "utf8"));
    raw.unreviewedPayload = {};
    raw.operations[0].dependsOn = [];
    expect(() => parseProposal(raw)).toThrow(/unreviewedPayload is not supported/);
    expect(() => parseProposal(raw)).toThrow(/dependsOn must be omitted when empty/);
  });

  it("requires explicit previous-revision lineage after revision 1", async () => {
    const raw = JSON.parse(await readFile(fixtureUrl, "utf8"));
    raw.revision = 2;
    expect(() => parseProposal(raw)).toThrow(/previousRevision is required/);
    raw.previousRevision = 1;
    expect(parseProposal(raw).previousRevision).toBe(1);
    raw.previousRevision = 2;
    expect(() => parseProposal(raw)).toThrow(/must identify an earlier revision/);
  });

  it("accepts valid createScript, deleteInstance, and reparentInstance operations", () => {
    const proposal = parseProposal({
      protocolVersion: "0.2",
      proposalId: "test-new-ops",
      revision: 1,
      title: "Test Protocol 0.2",
      summary: "Adding script, deleting instance, and reparenting",
      createdAt: new Date().toISOString(),
      producer: { name: "test", version: "0.2.0" },
      plan: { format: "markdown", content: "# Test Plan" },
      operations: [
        {
          id: "op-create-script",
          kind: "createScript",
          target: {
            parent: { path: ["ServerScriptService"] },
            className: "ModuleScript",
            name: "RewardHelper",
          },
          preconditions: { nameCollision: "fail" },
          after: { source: "local Helper = {}\nreturn Helper\n" },
        },
        {
          id: "op-delete-instance",
          kind: "deleteInstance",
          target: { path: ["ReplicatedStorage", "OldConfigs", "LegacyReward"] },
          preconditions: { className: "Configuration", maxChildren: 0 },
        },
        {
          id: "op-reparent",
          kind: "reparentInstance",
          target: { path: ["ReplicatedStorage", "OldConfigs", "KeepConfig"] },
          after: {
            parent: { path: ["ReplicatedStorage", "Configs"] },
            name: "ActiveConfig",
          },
          preconditions: { className: "Configuration", nameCollision: "fail" },
        },
      ],
    });

    expect(proposal.operations).toHaveLength(3);
    expect(proposalDigest(proposal)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects deleting a top-level root service", () => {
    expect(() =>
      parseProposal({
        protocolVersion: "0.2",
        proposalId: "test-delete-root",
        revision: 1,
        title: "Delete Root",
        summary: "Invalid",
        createdAt: new Date().toISOString(),
        producer: { name: "test", version: "0.2.0" },
        plan: { format: "markdown", content: "test" },
        operations: [
          {
            id: "op-delete-service",
            kind: "deleteInstance",
            target: { path: ["ServerScriptService"] },
            preconditions: {},
          },
        ],
      }),
    ).toThrow(/cannot delete a top-level service/);
  });
});

