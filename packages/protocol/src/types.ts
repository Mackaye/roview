export const protocolVersion = "0.2" as const;
export type ProtocolVersion = "0.1" | "0.2";

export const allowedCreateClasses = [
  "BindableEvent",
  "BindableFunction",
  "Configuration",
  "Folder",
  "RemoteEvent",
  "RemoteFunction",
] as const;

export const allowedScriptClasses = [
  "Script",
  "LocalScript",
  "ModuleScript",
] as const;

export type AllowedScriptClass = (typeof allowedScriptClasses)[number];

export const allowedPropertyValueTypes = {
  BackgroundColor3: ["Color3"],
  Enabled: ["boolean"],
  LayoutOrder: ["number"],
  Name: ["string"],
  Text: ["string"],
  TextColor3: ["Color3"],
  Value: ["boolean", "number", "string", "Color3", "Vector3"],
  Visible: ["boolean"],
} as const;

export interface Producer {
  name: string;
  version: string;
}

export interface Locator {
  path: string[];
  className?: string;
}

export type TaggedValue =
  | { type: "boolean"; value: boolean }
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "Color3"; r: number; g: number; b: number }
  | { type: "Vector3"; x: number; y: number; z: number }
  | { type: "Enum"; enum: string; item: string };

interface OperationBase {
  id: string;
  rationale?: string;
  dependsOn?: string[];
}

export interface CreateInstanceOperation extends OperationBase {
  kind: "createInstance";
  target: {
    parent: Locator;
    className: string;
    name: string;
  };
  preconditions: {
    parentClass?: string;
    nameCollision: "fail";
  };
}

export interface CreateScriptOperation extends OperationBase {
  kind: "createScript";
  target: {
    parent: Locator;
    className: AllowedScriptClass;
    name: string;
  };
  preconditions: {
    parentClass?: string;
    nameCollision: "fail";
  };
  after: { source: string };
}

export interface SetPropertyOperation extends OperationBase {
  kind: "setProperty";
  target: Locator;
  property: string;
  before: TaggedValue;
  after: TaggedValue;
}

export interface ReplaceScriptSourceOperation extends OperationBase {
  kind: "replaceScriptSource";
  target: Locator;
  before: { sourceSha256: string; source?: string };
  after: { source: string };
}

export interface DeleteInstanceOperation extends OperationBase {
  kind: "deleteInstance";
  target: Locator;
  preconditions: {
    className?: string;
    maxChildren?: number;
  };
}

export interface ReparentInstanceOperation extends OperationBase {
  kind: "reparentInstance";
  target: Locator;
  after: {
    parent?: Locator;
    name?: string;
  };
  preconditions: {
    className?: string;
    nameCollision: "fail";
  };
}

export type Operation =
  | CreateInstanceOperation
  | CreateScriptOperation
  | SetPropertyOperation
  | ReplaceScriptSourceOperation
  | DeleteInstanceOperation
  | ReparentInstanceOperation;

export interface Proposal {
  protocolVersion: ProtocolVersion;
  proposalId: string;
  revision: number;
  previousRevision?: number;
  title: string;
  summary: string;
  createdAt: string;
  producer: Producer;
  plan: {
    format: "markdown" | "plain";
    content: string;
  };
  operations: Operation[];
}


export type DecisionKind = "APPROVE" | "REJECT" | "REQUEST_CHANGES";

export interface ReviewComment {
  body: string;
  operationId?: string;
  line?: number;
  side?: "before" | "after";
}

export interface ReviewDecision {
  kind: DecisionKind;
  proposalDigest: string;
  comments: ReviewComment[];
  decidedAt: string;
}

export type ProposalStatus =
  | "READY_FOR_REVIEW"
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "APPROVED"
  | "PREFLIGHT"
  | "CONFLICTED"
  | "APPLYING"
  | "APPLIED"
  | "APPLY_FAILED"
  | "SUPERSEDED"
  | "CANCELLED";

export interface ReviewDraft {
  proposalId: string;
  revision: number;
  proposalDigest: string;
  generation: number;
  comments: ReviewComment[];
  globalComment: string;
  viewedItemIds: string[];
  updatedAt: string;
  deletedAt?: string;
}

export interface PreflightIssue {
  operationId: string;
  code:
    | "SOURCE_DRIFT"
    | "PROPERTY_DRIFT"
    | "LOCATOR_MISSING"
    | "NAME_COLLISION"
    | "CLASS_MISMATCH"
    | "CHILD_LIMIT_EXCEEDED"
    | "SERVICE_PROTECTION"
    | "GENERIC";
  message: string;
  expected?: unknown;
  actual?: unknown;
  currentSourceSha256?: string;
}

export interface PreflightReport {
  proposalDigest: string;
  checkedAt: string;
  errors: string[];
  issues?: PreflightIssue[];
}


export interface ApplyAttempt {
  attemptId: string;
  proposalDigest: string;
  startedAt: string;
}

export interface ApplyResult {
  attemptId: string;
  proposalDigest: string;
  success: boolean;
  message: string;
  completedAt: string;
}

export interface ProposalRecord {
  proposal: Proposal;
  digest: string;
  status: ProposalStatus;
  reviewedAt?: string;
  decision?: ReviewDecision;
  preflight?: PreflightReport;
  applyAttempt?: ApplyAttempt;
  applyResult?: ApplyResult;
}
