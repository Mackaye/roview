import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createCompanion } from "./server.js";
import { proposalDigest, type Proposal, type ProposalRecord } from "@roview/protocol";

const testToken = "test-token-entropy-e2e-suite-0123456789";
const activeServers: ReturnType<typeof createCompanion>["server"][] = [];

afterEach(async () => {
  await Promise.all(
    activeServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

async function startServer(customToken = testToken) {
  const pairingCode = "pairing-code-e2e-test";
  const companion = createCompanion({ token: customToken, pairingCode });
  activeServers.push(companion.server);
  await new Promise<void>((resolve) => companion.server.listen(0, "127.0.0.1", resolve));
  const { port } = companion.server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    token: customToken,
    pairingCode,
    headers: {
      Authorization: `Bearer ${customToken}`,
      "Content-Type": "application/json",
    },
  };
}

describe("Roview End-to-End Workflow (E2E)", () => {
  it("executes the complete agent submit -> review -> decision -> plugin preflight & apply loop", async () => {
    const { baseUrl, headers, pairingCode, token } = await startServer();

    // 1. Studio Plugin pairs with companion
    const pairRes = await fetch(`${baseUrl}/v1/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode }),
    });
    expect(pairRes.status).toBe(200);
    const paired = await pairRes.json() as { token: string; protocolVersion: string };
    expect(paired.token).toBe(token);

    // Initial plugin inbox check
    const initialInboxRes = await fetch(`${baseUrl}/v1/plugin/inbox`, { headers });
    expect(initialInboxRes.status).toBe(200);
    const initialInbox = await initialInboxRes.json() as { cursor: number; changed: boolean; proposals: ProposalRecord[] };
    expect(initialInbox.cursor).toBe(0);
    expect(initialInbox.proposals).toHaveLength(0);

    // 2. Agent submits a multi-operation proposal
    const rawProposal: Proposal = {
      protocolVersion: "0.2",
      proposalId: "e2e-daily-reward",
      revision: 1,
      title: "Add Daily Rewards Feature",
      summary: "Creates remote event, service script, and UI trigger for daily rewards",
      createdAt: new Date().toISOString(),
      producer: { name: "antigravity-mcp-agent", version: "1.0.0" },
      plan: {
        format: "markdown",
        content: "# Daily Rewards Plan\n- Create RemoteEvent\n- Create Server Script",
      },
      operations: [
        {
          id: "op_create_remote",
          kind: "createInstance",
          target: {
            parent: { path: ["ReplicatedStorage"] },
            className: "RemoteEvent",
            name: "DailyRewardClaim",
          },
          preconditions: { nameCollision: "fail" },
          rationale: "Network remote for reward claim",
        },
        {
          id: "op_create_script",
          dependsOn: ["op_create_remote"],
          kind: "createScript",
          target: {
            parent: { path: ["ServerScriptService"] },
            className: "Script",
            name: "DailyRewardsService",
          },
          preconditions: { nameCollision: "fail" },
          after: {
            source: 'local ReplicatedStorage = game:GetService("ReplicatedStorage")\nprint("Daily reward service ready")',
          },
          rationale: "Server script handling reward distribution",
        },
      ],
    };

    const submitRes = await fetch(`${baseUrl}/v1/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify(rawProposal),
    });
    expect(submitRes.status).toBe(201);
    const record = await submitRes.json() as ProposalRecord;
    expect(record.status).toBe("READY_FOR_REVIEW");
    expect(record.digest).toBe(proposalDigest(rawProposal));

    // 3. Studio plugin cursor polling receives update
    const updatedInboxRes = await fetch(`${baseUrl}/v1/plugin/inbox?after=0&waitMs=100`, { headers });
    expect(updatedInboxRes.status).toBe(200);
    const updatedInbox = await updatedInboxRes.json() as { cursor: number; changed: boolean; proposals: ProposalRecord[] };
    expect(updatedInbox.cursor).toBe(1);
    expect(updatedInbox.changed).toBe(true);
    expect(updatedInbox.proposals).toHaveLength(1);
    expect(updatedInbox.proposals[0]?.proposal.proposalId).toBe("e2e-daily-reward");

    // 4. Reviewer inspects proposal in Web UI and adds draft comments & marks viewed
    const draftRes = await fetch(`${baseUrl}/v1/proposals/e2e-daily-reward/1/draft`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        proposalDigest: record.digest,
        expectedGeneration: 0,
        comments: [
          {
            operationId: "op_create_script",
            side: "after",
            line: 2,
            body: "Looks good, clean init logging.",
          },
        ],
        globalComment: "Architecture approved.",
        viewedItemIds: ["plan", "op_create_remote", "op_create_script"],
      }),
    });
    expect(draftRes.status).toBe(200);
    const draftData = await draftRes.json() as { draft: { generation: number; globalComment: string } };
    expect(draftData.draft.generation).toBe(1);

    // 5. Reviewer officially approves the proposal
    const decisionRes = await fetch(`${baseUrl}/v1/proposals/e2e-daily-reward/1/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "APPROVE",
        comments: [
          {
            operationId: "op_create_script",
            side: "after",
            line: 2,
            body: "Looks good, clean init logging.",
          },
        ],
      }),
    });
    expect(decisionRes.status).toBe(200);
    const decidedRecord = await decisionRes.json() as ProposalRecord;
    expect(decidedRecord.status).toBe("APPROVED");
    expect(decidedRecord.decision?.kind).toBe("APPROVE");

    // 6. Studio Plugin preflight passes
    const preflightRes = await fetch(`${baseUrl}/v1/plugin/proposals/e2e-daily-reward/1/preflight`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        proposalDigest: record.digest,
        errors: [],
      }),
    });
    expect(preflightRes.status).toBe(200);
    const preflightRecord = await preflightRes.json() as ProposalRecord;
    expect(preflightRecord.status).toBe("PREFLIGHT");

    // 7. Studio Plugin initiates apply
    const beginApplyRes = await fetch(`${baseUrl}/v1/plugin/proposals/e2e-daily-reward/1/begin-apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        proposalDigest: record.digest,
      }),
    });
    expect(beginApplyRes.status).toBe(200);
    const applyingRecord = await beginApplyRes.json() as ProposalRecord;
    expect(applyingRecord.status).toBe("APPLYING");
    expect(applyingRecord.applyAttempt?.attemptId).toBeDefined();

    // 8. Studio Plugin executes operations inside ChangeHistoryService and posts result
    const resultRes = await fetch(`${baseUrl}/v1/plugin/proposals/e2e-daily-reward/1/result`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        proposalDigest: record.digest,
        attemptId: applyingRecord.applyAttempt?.attemptId,
        success: true,
        message: "Successfully applied 2 operations in 1 ChangeHistoryService recording.",
      }),
    });
    expect(resultRes.status).toBe(200);
    const appliedRecord = await resultRes.json() as ProposalRecord;
    expect(appliedRecord.status).toBe("APPLIED");
    expect(appliedRecord.applyResult?.success).toBe(true);

    // 9. Verify final audit status via CLI / Agent status endpoint
    const statusRes = await fetch(`${baseUrl}/v1/proposals/e2e-daily-reward/1`, { headers });
    expect(statusRes.status).toBe(200);
    const finalRecord = await statusRes.json() as ProposalRecord;
    expect(finalRecord.status).toBe("APPLIED");
  });

  it("handles multi-revision feedback loop (Changes Requested -> Revision 2 Approved)", async () => {
    const { baseUrl, headers } = await startServer();

    // Revision 1 submitted
    const rev1: Proposal = {
      protocolVersion: "0.2",
      proposalId: "feedback-loop-test",
      revision: 1,
      title: "Add Leaderstats Script",
      summary: "Adds coin and gem counters",
      createdAt: new Date().toISOString(),
      producer: { name: "agent", version: "1.0" },
      plan: { format: "plain", content: "Create leaderboard script" },
      operations: [
        {
          id: "op_leaderboard",
          kind: "createScript",
          target: {
            parent: { path: ["ServerScriptService"] },
            className: "Script",
            name: "Leaderboard",
          },
          preconditions: { nameCollision: "fail" },
          after: { source: "local coins = 0" },
        },
      ],
    };

    const submitRev1 = await fetch(`${baseUrl}/v1/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify(rev1),
    });
    const rev1Record = await submitRev1.json() as ProposalRecord;

    // Reviewer requests changes with an anchored comment
    const decisionRev1 = await fetch(`${baseUrl}/v1/proposals/feedback-loop-test/1/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "REQUEST_CHANGES",
        comments: [
          {
            operationId: "op_leaderboard",
            side: "after",
            line: 1,
            body: "Wrap in Players.PlayerAdded and create leaderstats folder.",
          },
        ],
      }),
    });
    expect(decisionRev1.status).toBe(200);
    const rev1Decided = await decisionRev1.json() as ProposalRecord;
    expect(rev1Decided.status).toBe("CHANGES_REQUESTED");

    // Agent submits Revision 2 referencing previous revision
    const rev2: Proposal = {
      protocolVersion: "0.2",
      proposalId: "feedback-loop-test",
      revision: 2,
      previousRevision: 1,
      title: "Add Leaderstats Script (Updated)",
      summary: "Adds coin and gem counters with player event binding",
      createdAt: new Date().toISOString(),
      producer: { name: "agent", version: "1.0" },
      plan: { format: "plain", content: "Create leaderboard script with PlayerAdded" },
      operations: [
        {
          id: "op_leaderboard",
          kind: "createScript",
          target: {
            parent: { path: ["ServerScriptService"] },
            className: "Script",
            name: "Leaderboard",
          },
          preconditions: { nameCollision: "fail" },
          after: {
            source: 'game:GetService("Players").PlayerAdded:Connect(function(player)\n  local f = Instance.new("Folder")\n  f.Name = "leaderstats"\n  f.Parent = player\nend)',
          },
        },
      ],
    };

    const submitRev2 = await fetch(`${baseUrl}/v1/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify(rev2),
    });
    expect(submitRev2.status).toBe(201);
    const rev2Record = await submitRev2.json() as ProposalRecord;
    expect(rev2Record.status).toBe("READY_FOR_REVIEW");
    expect(rev2Record.proposal.previousRevision).toBe(1);

    // Reviewer approves Revision 2
    const decisionRev2 = await fetch(`${baseUrl}/v1/proposals/feedback-loop-test/2/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "APPROVE",
        comments: [],
      }),
    });
    expect(decisionRev2.status).toBe(200);
    const rev2Decided = await decisionRev2.json() as ProposalRecord;
    expect(rev2Decided.status).toBe("APPROVED");
  });

  it("handles preflight conflict failures fail-closed without allowing apply", async () => {
    const { baseUrl, headers } = await startServer();

    const proposal: Proposal = {
      protocolVersion: "0.2",
      proposalId: "conflict-test",
      revision: 1,
      title: "Stale Buffer Edit",
      summary: "Replaces a script with strict hash",
      createdAt: new Date().toISOString(),
      producer: { name: "agent", version: "1.0" },
      plan: { format: "plain", content: "Update script" },
      operations: [
        {
          id: "op_stale",
          kind: "replaceScriptSource",
          target: { path: ["ServerScriptService", "ExistingScript"] },
          before: {
            sourceSha256: "0".repeat(64),
          },
          after: {
            source: "print('new')",
          },
        },
      ],
    };

    const submit = await fetch(`${baseUrl}/v1/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify(proposal),
    });
    const record = await submit.json() as ProposalRecord;

    // Approve
    await fetch(`${baseUrl}/v1/proposals/conflict-test/1/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "APPROVE", comments: [] }),
    });

    // Studio plugin preflight detects live script SHA256 mismatch
    const preflightRes = await fetch(`${baseUrl}/v1/plugin/proposals/conflict-test/1/preflight`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        proposalDigest: record.digest,
        errors: [
          "STALE_SCRIPT: Target script editor buffer SHA256 does not match proposal before-hash.",
        ],
      }),
    });
    expect(preflightRes.status).toBe(200);
    const conflictedRecord = await preflightRes.json() as ProposalRecord;
    expect(conflictedRecord.status).toBe("CONFLICTED");
    expect(conflictedRecord.preflight?.errors).toHaveLength(1);

    // Attempting to begin apply on a conflicted proposal MUST fail (status 400: Cannot begin apply from CONFLICTED)
    const beginApplyRes = await fetch(`${baseUrl}/v1/plugin/proposals/conflict-test/1/begin-apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        proposalDigest: record.digest,
      }),
    });
    expect(beginApplyRes.status).toBe(400);
    const errBody = await beginApplyRes.json() as { error: string };
    expect(errBody.error).toContain("Cannot begin apply from CONFLICTED");
  });
});
