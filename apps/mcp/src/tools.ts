import {
  allowedCreateClasses,
  allowedScriptClasses,
  parseProposal,
  type Proposal,
  type ProposalRecord,
  type ReviewComment,
} from "@roview/protocol";
import { z } from "zod/v4";
import { RoviewClient, openReviewInBrowser } from "./client.js";

const identifier = z.string().min(1).max(200);
const locatorSchema = z.object({
  path: z.array(z.string().min(1)).min(1).describe("Exact DataModel path segments, beginning with a service"),
  className: z.string().min(1).optional().describe("Optional expected target class"),
}).strict();

const taggedValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("number"), value: z.number().finite() }).strict(),
  z.object({ type: z.literal("string"), value: z.string() }).strict(),
  z.object({ type: z.literal("Color3"), r: z.number().min(0).max(1), g: z.number().min(0).max(1), b: z.number().min(0).max(1) }).strict(),
  z.object({ type: z.literal("Vector3"), x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).strict(),
  z.object({ type: z.literal("Enum"), enum: z.string().min(1), item: z.string().min(1) }).strict(),
]);

const operationBase = {
  id: identifier.describe("Stable operation ID used for dependencies and anchored feedback"),
  rationale: z.string().min(1).optional(),
  dependsOn: z.array(identifier).min(1).optional(),
};

const operationSchema = z.discriminatedUnion("kind", [
  z.object({
    ...operationBase,
    kind: z.literal("createInstance"),
    target: z.object({
      parent: locatorSchema,
      className: z.enum(allowedCreateClasses),
      name: z.string().min(1),
    }).strict(),
    preconditions: z.object({
      parentClass: z.string().min(1).optional(),
      nameCollision: z.literal("fail"),
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    kind: z.literal("createScript"),
    target: z.object({
      parent: locatorSchema,
      className: z.enum(allowedScriptClasses),
      name: z.string().min(1),
    }).strict(),
    preconditions: z.object({
      parentClass: z.string().min(1).optional(),
      nameCollision: z.literal("fail"),
    }).strict(),
    after: z.object({ source: z.string().max(5_000_000) }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    kind: z.literal("setProperty"),
    target: locatorSchema,
    property: z.string().min(1).describe("Property must be allowed by Roview protocol"),
    before: taggedValueSchema,
    after: taggedValueSchema,
  }).strict(),
  z.object({
    ...operationBase,
    kind: z.literal("replaceScriptSource"),
    target: locatorSchema,
    before: z.object({
      sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
      source: z.string().max(5_000_000).optional(),
    }).strict(),
    after: z.object({ source: z.string().max(5_000_000) }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    kind: z.literal("deleteInstance"),
    target: locatorSchema,
    preconditions: z.object({
      className: z.string().min(1).optional(),
      maxChildren: z.number().int().min(0).optional(),
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    kind: z.literal("reparentInstance"),
    target: locatorSchema,
    after: z.object({
      parent: locatorSchema.optional(),
      name: z.string().min(1).optional(),
    }).strict(),
    preconditions: z.object({
      className: z.string().min(1).optional(),
      nameCollision: z.literal("fail"),
    }).strict(),
  }).strict(),
]);

export const reviewChangesSchema = z.object({
  proposalId: identifier.describe("Stable unique ID; reuse it when submitting a revised version"),
  revision: z.number().int().positive().default(1).describe("Increment for every changed resubmission"),
  previousRevision: z.number().int().positive().optional()
    .describe("Exact prior revision in this lineage; required after revision 1"),
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(2_000),
  plan: z.object({
    format: z.enum(["markdown", "plain"]).default("markdown"),
    content: z.string().min(1),
  }).strict(),
  operations: z.array(operationSchema).min(1).max(1_000),
  waitSeconds: z.number().int().min(1).max(3_600).default(900)
    .describe("How long to wait for the human decision before returning a pending result"),
}).strict().superRefine((value, context) => {
  if (value.revision === 1 && value.previousRevision !== undefined) {
    context.addIssue({ code: "custom", path: ["previousRevision"], message: "must be omitted for revision 1" });
  }
  if (value.revision > 1 && value.previousRevision === undefined) {
    context.addIssue({ code: "custom", path: ["previousRevision"], message: "is required after revision 1" });
  }
  if (value.previousRevision !== undefined && value.previousRevision >= value.revision) {
    context.addIssue({ code: "custom", path: ["previousRevision"], message: "must identify an earlier revision" });
  }
});

export const reviewStatusSchema = z.object({
  proposalId: identifier,
  revision: z.number().int().positive(),
  waitSeconds: z.number().int().min(0).max(3_600).default(0)
    .describe("Zero returns immediately; a positive value waits for a decision"),
}).strict();

export type ReviewChangesInput = z.infer<typeof reviewChangesSchema>;
export type ReviewStatusInput = z.infer<typeof reviewStatusSchema>;

interface ReviewToolOptions {
  openBrowser?: (url: string) => void;
}

const commentAnchor = (comment: ReviewComment) => {
  const parts = [comment.operationId, comment.side, comment.line === undefined ? undefined : `line ${comment.line}`]
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? `[${parts.join(" · ")}] ` : "";
};

const feedbackText = (comments: ReviewComment[]) => comments.length === 0
  ? "No written feedback was supplied."
  : comments.map((comment, index) => `${index + 1}. ${commentAnchor(comment)}${comment.body}`).join("\n");

export const formatReviewResult = (record: ProposalRecord, timedOut = false) => {
  const identity = `${record.proposal.proposalId} revision ${record.proposal.revision}`;
  if (timedOut) {
    return `PENDING: ${identity} is still ${record.status}. The proposal remains durable. Call get_review with the same identifiers to continue waiting.`;
  }
  if (record.status === "APPROVED") {
    return `APPROVED: ${identity}. Approval permits the Roview Studio plugin to run independent preflight; it does not apply changes. Do not bypass Roview by making the reviewed mutations directly through Roblox Studio MCP.\n\nApproval notes:\n${feedbackText(record.decision?.comments ?? [])}`;
  }
  if (record.status === "CHANGES_REQUESTED") {
    return `CHANGES_REQUESTED: ${identity}. Revise the proposal using the feedback below, keep proposalId ${record.proposal.proposalId}, increment the revision to ${record.proposal.revision + 1}, set previousRevision to ${record.proposal.revision}, refresh all Studio-derived preconditions, and call review_changes again. Do not mutate Studio directly.\n\nHuman feedback:\n${feedbackText(record.decision?.comments ?? [])}`;
  }
  if (record.status === "CONFLICTED") {
    const errorList = record.preflight?.errors?.length
      ? record.preflight.errors.map((err, i) => `${i + 1}. ${err}`).join("\n")
      : "Preflight checks encountered live Studio state conflicts.";
    const driftDetails = record.preflight?.issues
      ?.filter((issue) => issue.code === "SOURCE_DRIFT" && issue.currentSourceSha256)
      .map((issue) => `• Operation '${issue.operationId}': latest live Studio script SHA-256 is ${issue.currentSourceSha256}`)
      .join("\n");
    const driftText = driftDetails ? `\n\nLive script drift details:\n${driftDetails}` : "";
    return `CONFLICTED: ${identity}. Studio preflight failed because live DataModel state changed or conflicted with reviewed preconditions.\n\nPreflight issues:\n${errorList}${driftText}\n\nRecovery instructions:\n1. Inspect the latest Studio state using read-only tools.\n2. Refresh all preconditions (e.g. read current script source and compute new SHA-256).\n3. Keep proposalId '${record.proposal.proposalId}', increment revision to ${record.proposal.revision + 1}, set previousRevision to ${record.proposal.revision}, and call review_changes again.\n4. Do not bypass Roview by attempting to mutate Studio directly.`;
  }
  if (record.status === "APPLIED") {
    return `APPLIED: ${identity}. The approved changes were successfully applied in Roblox Studio (${record.applyResult?.message || "1-step undoable action recorded"}). You may now verify the place state and run playtests using read-only Studio MCP tools.`;
  }
  if (record.status === "APPLY_FAILED") {
    return `APPLY_FAILED: ${identity}. Studio apply failed: ${record.applyResult?.message || "Operation failed during execution; changes were rolled back"}. Inspect the place state, adjust your proposal, increment revision, and resubmit if appropriate.`;
  }
  if (record.status === "PREFLIGHT") {
    return `PREFLIGHT: ${identity}. Preflight succeeded in Roblox Studio. Studio is ready to apply the approved changes upon developer confirmation.`;
  }
  if (record.status === "APPLYING") {
    return `APPLYING: ${identity}. Studio is currently executing the reviewed changes.`;
  }
  if (record.status === "REJECTED") {
    return `REJECTED: ${identity}. Stop this change unless the user explicitly asks for a new proposal.\n\nHuman feedback:\n${feedbackText(record.decision?.comments ?? [])}`;
  }
  if (record.status === "CANCELLED") return `CANCELLED: ${identity}. Do not apply or resubmit it without new user direction.`;
  return `${record.status}: ${identity}. Approval, if present, only permits Studio preflight and never authorizes direct MCP mutation.`;
};


const proposalFromInput = (input: ReviewChangesInput): Proposal => parseProposal({
  protocolVersion: "0.2",
  proposalId: input.proposalId,
  revision: input.revision,
  ...(input.previousRevision === undefined ? {} : { previousRevision: input.previousRevision }),
  title: input.title,
  summary: input.summary,
  createdAt: new Date().toISOString(),
  producer: { name: "roview-mcp", version: "0.2.0-draft.0" },
  plan: input.plan,
  operations: input.operations,
});


export async function reviewChanges(
  client: RoviewClient,
  input: ReviewChangesInput,
  signal?: AbortSignal,
  options: ReviewToolOptions = {},
) {
  const record = await client.submit(proposalFromInput(input), signal);
  (options.openBrowser ?? openReviewInBrowser)(client.reviewUrl());
  const result = await client.waitForDecision(record.proposal.proposalId, record.proposal.revision, {
    timeoutSeconds: input.waitSeconds,
    ...(signal ? { signal } : {}),
  });
  return { record: result.record, text: formatReviewResult(result.record, result.timedOut) };
}

export async function getReview(client: RoviewClient, input: ReviewStatusInput, signal?: AbortSignal) {
  if (input.waitSeconds === 0) {
    const record = await client.get(input.proposalId, input.revision, signal);
    return { record, text: formatReviewResult(record) };
  }
  const result = await client.waitForDecision(input.proposalId, input.revision, {
    timeoutSeconds: input.waitSeconds,
    ...(signal ? { signal } : {}),
  });
  return { record: result.record, text: formatReviewResult(result.record, result.timedOut) };
}
