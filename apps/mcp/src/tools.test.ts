import { describe, expect, it } from "vitest";
import type { ProposalRecord } from "@roview/protocol";
import { formatReviewResult, reviewChangesSchema } from "./tools.js";

const record = (status: ProposalRecord["status"]): ProposalRecord => {
  const value: ProposalRecord = {
    proposal: {
    protocolVersion: "0.2",
	    proposalId: "feedback-loop",
	    revision: 2,
	    previousRevision: 1,
    title: "Feedback loop",
    summary: "Test direct feedback",
    createdAt: "2026-08-17T10:00:00.000Z",
    producer: { name: "roview-mcp", version: "test" },
    plan: { format: "plain", content: "Replace a script" },
    operations: [{
      id: "script_edit",
      kind: "replaceScriptSource",
      target: { path: ["ServerScriptService", "Main"], className: "Script" },
      before: { sourceSha256: "0".repeat(64) },
      after: { source: "print('reviewed')" },
    }],
    },
    digest: "1".repeat(64),
    status,
  };
  if (status === "CHANGES_REQUESTED") {
    value.decision = {
      kind: "REQUEST_CHANGES",
      proposalDigest: "1".repeat(64),
      comments: [{ operationId: "script_edit", side: "after", line: 1, body: "Handle the failure path." }],
      decidedAt: "2026-08-17T10:01:00.000Z",
    };
  }
  return value;
};

describe("MCP review result", () => {
  it("returns anchored feedback and explicit revision instructions", () => {
    const text = formatReviewResult(record("CHANGES_REQUESTED"));
    expect(text).toContain("[script_edit · after · line 1] Handle the failure path.");
    expect(text).toContain("increment the revision to 3");
    expect(text).toContain("previousRevision to 2");
    expect(text).toContain("Do not mutate Studio directly");
  });

  it("keeps approval separate from Studio mutation authority", () => {
    const approved = record("APPROVED");
    approved.decision = {
      kind: "APPROVE",
      proposalDigest: approved.digest,
      comments: [],
      decidedAt: "2026-08-17T10:01:00.000Z",
    };
    expect(formatReviewResult(approved)).toContain("Studio plugin to run independent preflight");
    expect(formatReviewResult(approved)).toContain("Do not bypass Roview");
  });

  it("validates reviewChangesSchema with Protocol 0.2 operations", () => {
    const input = {
      proposalId: "test-mcp-ops",
      revision: 1,
      title: "Protocol 0.2 Test",
      summary: "Testing createScript, deleteInstance, reparentInstance",
      plan: { format: "markdown" as const, content: "Plan content" },
      operations: [
        {
          id: "op1",
          kind: "createScript" as const,
          target: {
            parent: { path: ["ServerScriptService"] },
            className: "ModuleScript" as const,
            name: "Helper",
          },
          preconditions: { nameCollision: "fail" as const },
          after: { source: "return {}" },
        },
        {
          id: "op2",
          kind: "deleteInstance" as const,
          target: { path: ["ReplicatedStorage", "OldFolder"] },
          preconditions: { maxChildren: 0 },
        },
        {
          id: "op3",
          kind: "reparentInstance" as const,
          target: { path: ["ReplicatedStorage", "Item"] },
          after: { name: "NewItem" },
          preconditions: { nameCollision: "fail" as const },
        },
      ],
    };

    expect(() => reviewChangesSchema.parse(input)).not.toThrow();
  });

  it("formats CONFLICTED status with live script drift details and recovery steps", () => {
    const conflicted = record("CONFLICTED");
    conflicted.preflight = {
      proposalDigest: conflicted.digest,
      checkedAt: "2026-08-18T10:00:00.000Z",
      errors: ["script_edit: script source changed in Studio since review"],
      issues: [
        {
          operationId: "script_edit",
          code: "SOURCE_DRIFT",
          message: "script source changed in Studio since review",
          expected: "0".repeat(64),
          actual: "a".repeat(64),
          currentSourceSha256: "a".repeat(64),
        },
      ],
    };
    const text = formatReviewResult(conflicted);
    expect(text).toContain("CONFLICTED:");
    expect(text).toContain("script source changed in Studio since review");
    expect(text).toContain(`latest live Studio script SHA-256 is ${"a".repeat(64)}`);
    expect(text).toContain("increment revision to 3");
    expect(text).toContain("set previousRevision to 2");
  });

  it("formats APPLIED and APPLY_FAILED status clearly", () => {
    const applied = record("APPLIED");
    applied.applyResult = {
      attemptId: "att-1",
      proposalDigest: applied.digest,
      success: true,
      message: "1-step undoable action recorded",
      completedAt: "2026-08-18T10:00:00.000Z",
    };
    expect(formatReviewResult(applied)).toContain("APPLIED:");
    expect(formatReviewResult(applied)).toContain("1-step undoable action recorded");

    const failed = record("APPLY_FAILED");
    failed.applyResult = {
      attemptId: "att-2",
      proposalDigest: failed.digest,
      success: false,
      message: "Target instance was destroyed during apply",
      completedAt: "2026-08-18T10:00:00.000Z",
    };
    expect(formatReviewResult(failed)).toContain("APPLY_FAILED:");
    expect(formatReviewResult(failed)).toContain("Target instance was destroyed during apply");
  });
});


