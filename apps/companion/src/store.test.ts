import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { proposalDigest, type Proposal, type ProposalRecord } from "@roview/protocol";
import { ProposalStore } from "./store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const proposal: Proposal = {
  protocolVersion: "0.1",
  proposalId: "persistent",
  revision: 1,
  title: "Persistence test",
  summary: "Confirms local recovery",
  createdAt: new Date().toISOString(),
  producer: { name: "test", version: "1" },
  plan: { format: "plain", content: "Create one folder" },
  operations: [{
    id: "create",
    kind: "createInstance",
    target: { parent: { path: ["ReplicatedStorage"] }, className: "Folder", name: "Persistent" },
    preconditions: { nameCollision: "fail" },
  }],
};
const digest = proposalDigest(proposal);

async function storePath() {
  const directory = await mkdtemp(join(tmpdir(), "roview-store-"));
  temporaryDirectories.push(directory);
  return join(directory, "proposals.json");
}

describe("proposal persistence", () => {
  it("accepts an identical retry but rejects changed content for the same revision", async () => {
    const store = new ProposalStore();
    const record: ProposalRecord = { proposal, digest, status: "READY_FOR_REVIEW" };
    expect(await store.put(record)).toBe(record);
    const retried = structuredClone(record);
    retried.proposal.createdAt = "2026-08-17T11:30:00.000Z";
    retried.digest = proposalDigest(retried.proposal);
    expect(await store.put(retried)).toEqual(record);

    const changed = structuredClone(record);
    changed.proposal.title = "Changed after the revision was allocated";
    changed.digest = proposalDigest(changed.proposal);
    await expect(store.put(changed)).rejects.toThrow("different content");
  });

  it("atomically persists and reloads proposal records", async () => {
    const path = await storePath();
    const store = await ProposalStore.open(path);
    await store.put({ proposal, digest, status: "READY_FOR_REVIEW" });

    const reopened = await ProposalStore.open(path);
    expect(reopened.get("persistent", 1)?.status).toBe("READY_FOR_REVIEW");
    expect(JSON.parse(await readFile(path, "utf8")).version).toBe(2);
  });

  it("fails closed when the companion restarts during apply", async () => {
    const path = await storePath();
    const applying: ProposalRecord = {
      proposal,
      digest,
      status: "APPLYING",
      applyAttempt: {
        attemptId: "attempt-1",
        proposalDigest: digest,
        startedAt: "2026-08-17T00:01:00.000Z",
      },
    };
    const store = new ProposalStore({ persistencePath: path, records: [applying] });
    await store.flush();

    const reopened = await ProposalStore.open(path);
    expect(reopened.get("persistent", 1)?.status).toBe("APPLY_FAILED");
    expect(reopened.get("persistent", 1)?.applyResult?.message).toContain("automatic replay is disabled");
  });

  it("deletes all retained proposal data", async () => {
    const path = await storePath();
    const store = await ProposalStore.open(path);
    await store.put({
      proposal,
      digest,
      status: "READY_FOR_REVIEW",
    });
    expect(await store.deleteAll()).toBe(1);
    expect((await ProposalStore.open(path)).list()).toEqual([]);
  });

  it("forms a linear revision lineage and supersedes only the active tip", async () => {
    const store = new ProposalStore();
    await store.put({ proposal, digest, status: "READY_FOR_REVIEW" });
    const revisionTwo = structuredClone(proposal);
    revisionTwo.revision = 2;
    revisionTwo.previousRevision = 1;
    revisionTwo.title = "Revised after feedback";
    const revisionTwoDigest = proposalDigest(revisionTwo);
    await store.put({ proposal: revisionTwo, digest: revisionTwoDigest, status: "READY_FOR_REVIEW" });

    expect(store.get("persistent", 1)?.status).toBe("SUPERSEDED");
    expect(store.get("persistent", 2)?.status).toBe("READY_FOR_REVIEW");

    const fork = structuredClone(revisionTwo);
    fork.revision = 3;
    fork.previousRevision = 1;
    await expect(store.put({ proposal: fork, digest: proposalDigest(fork), status: "READY_FOR_REVIEW" }))
      .rejects.toThrow("active lineage tip");
  });

  it("persists digest-bound drafts and rejects stale writes after deletion", async () => {
    const path = await storePath();
    const store = await ProposalStore.open(path);
    await store.put({ proposal, digest, status: "READY_FOR_REVIEW" });
    const draftInput = {
      proposalId: proposal.proposalId,
      revision: proposal.revision,
      proposalDigest: digest,
      comments: [{ body: "Check this operation", operationId: "create" }],
      globalComment: "Overall note",
      viewedItemIds: ["plan", "create"],
    };
    const saved = await store.saveDraft(draftInput, 0);
    expect(saved.generation).toBe(1);
    expect((await ProposalStore.open(path)).getDraft(proposal.proposalId, 1)?.globalComment).toBe("Overall note");

    await store.deleteDraft(proposal.proposalId, 1, digest, 1);
    await expect(store.saveDraft(draftInput, 1)).rejects.toThrow("generation is stale");
    expect(store.getDraft(proposal.proposalId, 1)).toBeUndefined();
  });

  it("orders actionable inbox records before terminal history and exposes change cursors", async () => {
    const store = new ProposalStore();
    const terminalProposal = structuredClone(proposal);
    terminalProposal.proposalId = "terminal";
    terminalProposal.createdAt = "2026-08-17T12:00:00.000Z";
    await store.put({ proposal: terminalProposal, digest: proposalDigest(terminalProposal), status: "REJECTED" });
    await store.put({ proposal, digest, status: "READY_FOR_REVIEW" });
    expect(store.list().map((record) => record.proposal.proposalId)).toEqual(["persistent", "terminal"]);
    expect(store.cursor).toBe(2);
    expect(await store.waitForChange(0, 1)).toBe(2);
    expect((await store.markReviewed("persistent", 1)).reviewedAt).toBeTruthy();
    expect(store.cursor).toBe(3);
  });
});
