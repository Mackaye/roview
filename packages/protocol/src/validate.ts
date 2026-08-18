import { createHash } from "node:crypto";
import {
  allowedCreateClasses,
  allowedPropertyValueTypes,
  allowedScriptClasses,
  type Locator,
  type Operation,
  type Proposal,
  type TaggedValue,
} from "./types.js";

const MAX_OPERATIONS = 1_000;
const MAX_SOURCE_LENGTH = 5_000_000;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const allowedClassSet = new Set<string>(allowedCreateClasses);
const allowedScriptClassSet = new Set<string>(allowedScriptClasses);
const allowedPropertyTypes = allowedPropertyValueTypes as Record<string, readonly string[]>;

export class ProtocolValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid Roview proposal: ${issues.join("; ")}`);
    this.name = "ProtocolValidationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rejectUnknownFields = (
  record: Record<string, unknown>,
  allowed: readonly string[],
  issues: string[],
  path: string,
) => {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) issues.push(`${path}.${key} is not supported`);
  }
};

const stringField = (record: Record<string, unknown>, key: string, issues: string[], path: string) => {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) issues.push(`${path}.${key} must be a non-empty string`);
  return typeof value === "string" ? value : "";
};

const validateLocator = (value: unknown, issues: string[], path: string): value is Locator => {
  if (!isRecord(value) || !Array.isArray(value.path) || value.path.length === 0) {
    issues.push(`${path}.path must be a non-empty array`);
    return false;
  }
  rejectUnknownFields(value, ["path", "className"], issues, path);
  if (value.path.some((segment) => typeof segment !== "string" || segment.length === 0)) {
    issues.push(`${path}.path contains an invalid segment`);
  }
  if (value.className !== undefined && typeof value.className !== "string") {
    issues.push(`${path}.className must be a string`);
  }
  return true;
};

const validateTaggedValue = (value: unknown, issues: string[], path: string): value is TaggedValue => {
  if (!isRecord(value) || typeof value.type !== "string") {
    issues.push(`${path} must be a tagged value`);
    return false;
  }
  const commonFields = ["type"];
  switch (value.type) {
    case "boolean":
      rejectUnknownFields(value, [...commonFields, "value"], issues, path);
      if (typeof value.value !== "boolean") issues.push(`${path}.value must be a boolean`);
      break;
    case "number":
      rejectUnknownFields(value, [...commonFields, "value"], issues, path);
      if (typeof value.value !== "number" || !Number.isFinite(value.value)) issues.push(`${path}.value must be finite`);
      break;
    case "string":
      rejectUnknownFields(value, [...commonFields, "value"], issues, path);
      if (typeof value.value !== "string") issues.push(`${path}.value must be a string`);
      break;
    case "Color3":
      rejectUnknownFields(value, [...commonFields, "r", "g", "b"], issues, path);
      for (const channel of ["r", "g", "b"] as const) {
        if (typeof value[channel] !== "number" || value[channel] < 0 || value[channel] > 1) {
          issues.push(`${path}.${channel} must be between 0 and 1`);
        }
      }
      break;
    case "Vector3":
      rejectUnknownFields(value, [...commonFields, "x", "y", "z"], issues, path);
      for (const axis of ["x", "y", "z"] as const) {
        if (typeof value[axis] !== "number" || !Number.isFinite(value[axis])) issues.push(`${path}.${axis} must be finite`);
      }
      break;
    case "Enum":
      rejectUnknownFields(value, [...commonFields, "enum", "item"], issues, path);
      stringField(value, "enum", issues, path);
      stringField(value, "item", issues, path);
      break;
    default:
      issues.push(`${path}.type is unsupported`);
  }
  return true;
};

const validateOperation = (value: unknown, index: number, issues: string[]): value is Operation => {
  const path = `operations[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return false;
  }
  stringField(value, "id", issues, path);
  if (value.rationale !== undefined && typeof value.rationale !== "string") {
    issues.push(`${path}.rationale must be a string`);
  }
  if (value.dependsOn !== undefined) {
    if (!Array.isArray(value.dependsOn) || value.dependsOn.some((id) => typeof id !== "string")) {
      issues.push(`${path}.dependsOn must contain operation IDs`);
    } else if (value.dependsOn.length === 0) {
      issues.push(`${path}.dependsOn must be omitted when empty`);
    }
  }
  switch (value.kind) {
    case "createInstance": {
      rejectUnknownFields(value, ["id", "kind", "rationale", "dependsOn", "target", "preconditions"], issues, path);
      if (!isRecord(value.target)) issues.push(`${path}.target must be an object`);
      else {
        rejectUnknownFields(value.target, ["parent", "className", "name"], issues, `${path}.target`);
        validateLocator(value.target.parent, issues, `${path}.target.parent`);
        const className = stringField(value.target, "className", issues, `${path}.target`);
        if (className && !allowedClassSet.has(className)) issues.push(`${path}.target.className is not allowed`);
        stringField(value.target, "name", issues, `${path}.target`);
      }
      if (!isRecord(value.preconditions) || value.preconditions.nameCollision !== "fail") {
        issues.push(`${path}.preconditions.nameCollision must be fail`);
      } else {
        rejectUnknownFields(value.preconditions, ["parentClass", "nameCollision"], issues, `${path}.preconditions`);
        if (value.preconditions.parentClass !== undefined && typeof value.preconditions.parentClass !== "string") {
          issues.push(`${path}.preconditions.parentClass must be a string`);
        }
      }
      break;
    }
    case "createScript": {
      rejectUnknownFields(value, ["id", "kind", "rationale", "dependsOn", "target", "preconditions", "after"], issues, path);
      if (!isRecord(value.target)) issues.push(`${path}.target must be an object`);
      else {
        rejectUnknownFields(value.target, ["parent", "className", "name"], issues, `${path}.target`);
        validateLocator(value.target.parent, issues, `${path}.target.parent`);
        const className = stringField(value.target, "className", issues, `${path}.target`);
        if (className && !allowedScriptClassSet.has(className)) issues.push(`${path}.target.className must be Script, LocalScript, or ModuleScript`);
        stringField(value.target, "name", issues, `${path}.target`);
      }
      if (!isRecord(value.preconditions) || value.preconditions.nameCollision !== "fail") {
        issues.push(`${path}.preconditions.nameCollision must be fail`);
      } else {
        rejectUnknownFields(value.preconditions, ["parentClass", "nameCollision"], issues, `${path}.preconditions`);
        if (value.preconditions.parentClass !== undefined && typeof value.preconditions.parentClass !== "string") {
          issues.push(`${path}.preconditions.parentClass must be a string`);
        }
      }
      if (!isRecord(value.after) || typeof value.after.source !== "string") {
        issues.push(`${path}.after.source must be a string`);
      } else {
        rejectUnknownFields(value.after, ["source"], issues, `${path}.after`);
        if (value.after.source.length > MAX_SOURCE_LENGTH) issues.push(`${path}.after.source exceeds the size limit`);
      }
      break;
    }
    case "setProperty": {
      rejectUnknownFields(value, ["id", "kind", "rationale", "dependsOn", "target", "property", "before", "after"], issues, path);
      validateLocator(value.target, issues, `${path}.target`);
      const property = stringField(value, "property", issues, path);
      validateTaggedValue(value.before, issues, `${path}.before`);
      validateTaggedValue(value.after, issues, `${path}.after`);
      const allowedTypes = allowedPropertyTypes[property];
      if (!allowedTypes) issues.push(`${path}.property is not allowed`);
      if (allowedTypes && isRecord(value.before) && typeof value.before.type === "string" && !allowedTypes.includes(value.before.type)) {
        issues.push(`${path}.before type is not allowed for ${property}`);
      }
      if (allowedTypes && isRecord(value.after) && typeof value.after.type === "string" && !allowedTypes.includes(value.after.type)) {
        issues.push(`${path}.after type is not allowed for ${property}`);
      }
      if (isRecord(value.before) && isRecord(value.after) && value.before.type !== value.after.type) {
        issues.push(`${path}.before and after tagged types must match`);
      }
      break;
    }
    case "replaceScriptSource":
      rejectUnknownFields(value, ["id", "kind", "rationale", "dependsOn", "target", "before", "after"], issues, path);
      validateLocator(value.target, issues, `${path}.target`);
      if (isRecord(value.before)) {
        rejectUnknownFields(value.before, ["sourceSha256", "source"], issues, `${path}.before`);
      }
      if (!isRecord(value.before) || typeof value.before.sourceSha256 !== "string" || !SHA_256_PATTERN.test(value.before.sourceSha256)) {
        issues.push(`${path}.before.sourceSha256 must be a lowercase SHA-256 digest`);
      } else if (value.before.source !== undefined) {
        if (typeof value.before.source !== "string") issues.push(`${path}.before.source must be a string`);
        else if (value.before.source.length > MAX_SOURCE_LENGTH) issues.push(`${path}.before.source exceeds the size limit`);
        else if (createHash("sha256").update(value.before.source, "utf8").digest("hex") !== value.before.sourceSha256) {
          issues.push(`${path}.before.source does not match sourceSha256`);
        }
      }
      if (!isRecord(value.after) || typeof value.after.source !== "string") issues.push(`${path}.after.source must be a string`);
      else {
        rejectUnknownFields(value.after, ["source"], issues, `${path}.after`);
        if (value.after.source.length > MAX_SOURCE_LENGTH) issues.push(`${path}.after.source exceeds the size limit`);
      }
      break;
    case "deleteInstance": {
      rejectUnknownFields(value, ["id", "kind", "rationale", "dependsOn", "target", "preconditions"], issues, path);
      validateLocator(value.target, issues, `${path}.target`);
      if (isRecord(value.target) && Array.isArray(value.target.path) && value.target.path.length <= 1) {
        issues.push(`${path}.target cannot delete a top-level service`);
      }
      if (!isRecord(value.preconditions)) issues.push(`${path}.preconditions must be an object`);
      else {
        rejectUnknownFields(value.preconditions, ["className", "maxChildren"], issues, `${path}.preconditions`);
        if (value.preconditions.className !== undefined && typeof value.preconditions.className !== "string") {
          issues.push(`${path}.preconditions.className must be a string`);
        }
        if (
          value.preconditions.maxChildren !== undefined
          && (!Number.isInteger(value.preconditions.maxChildren) || (value.preconditions.maxChildren as number) < 0)
        ) {
          issues.push(`${path}.preconditions.maxChildren must be a non-negative integer`);
        }
      }
      break;
    }
    case "reparentInstance": {
      rejectUnknownFields(value, ["id", "kind", "rationale", "dependsOn", "target", "after", "preconditions"], issues, path);
      validateLocator(value.target, issues, `${path}.target`);
      if (isRecord(value.target) && Array.isArray(value.target.path) && value.target.path.length <= 1) {
        issues.push(`${path}.target cannot reparent a top-level service`);
      }
      if (!isRecord(value.after)) issues.push(`${path}.after must be an object`);
      else {
        rejectUnknownFields(value.after, ["parent", "name"], issues, `${path}.after`);
        if (value.after.parent === undefined && value.after.name === undefined) {
          issues.push(`${path}.after must specify parent and/or name`);
        }
        if (value.after.parent !== undefined) {
          validateLocator(value.after.parent, issues, `${path}.after.parent`);
        }
        if (value.after.name !== undefined) {
          stringField(value.after, "name", issues, `${path}.after`);
        }
      }
      if (!isRecord(value.preconditions) || value.preconditions.nameCollision !== "fail") {
        issues.push(`${path}.preconditions.nameCollision must be fail`);
      } else {
        rejectUnknownFields(value.preconditions, ["className", "nameCollision"], issues, `${path}.preconditions`);
        if (value.preconditions.className !== undefined && typeof value.preconditions.className !== "string") {
          issues.push(`${path}.preconditions.className must be a string`);
        }
      }
      break;
    }
    default:
      issues.push(`${path}.kind is unsupported`);
  }
  return true;
};

export function parseProposal(value: unknown): Proposal {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ProtocolValidationError(["proposal must be an object"]);
  rejectUnknownFields(
    value,
    ["protocolVersion", "proposalId", "revision", "previousRevision", "title", "summary", "createdAt", "producer", "plan", "operations"],
    issues,
    "proposal",
  );
  if (value.protocolVersion !== "0.1" && value.protocolVersion !== "0.2") {
    issues.push("protocolVersion must be 0.1 or 0.2");
  }
  stringField(value, "proposalId", issues, "proposal");

  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) issues.push("proposal.revision must be a positive integer");
  if (value.revision === 1 && value.previousRevision !== undefined) {
    issues.push("proposal.previousRevision must be omitted for revision 1");
  }
  if ((value.revision as number) > 1) {
    if (!Number.isInteger(value.previousRevision) || (value.previousRevision as number) < 1) {
      issues.push("proposal.previousRevision is required after revision 1");
    } else if ((value.previousRevision as number) >= (value.revision as number)) {
      issues.push("proposal.previousRevision must identify an earlier revision");
    }
  }
  stringField(value, "title", issues, "proposal");
  stringField(value, "summary", issues, "proposal");
  const createdAt = stringField(value, "createdAt", issues, "proposal");
  if (createdAt && Number.isNaN(Date.parse(createdAt))) issues.push("proposal.createdAt must be an ISO date");

  if (!isRecord(value.producer)) issues.push("proposal.producer must be an object");
  else {
    rejectUnknownFields(value.producer, ["name", "version"], issues, "proposal.producer");
    stringField(value.producer, "name", issues, "proposal.producer");
    stringField(value.producer, "version", issues, "proposal.producer");
  }
  if (!isRecord(value.plan)) issues.push("proposal.plan must be an object");
  else {
    rejectUnknownFields(value.plan, ["format", "content"], issues, "proposal.plan");
    if (value.plan.format !== "markdown" && value.plan.format !== "plain") issues.push("proposal.plan.format is unsupported");
    stringField(value.plan, "content", issues, "proposal.plan");
  }
  if (!Array.isArray(value.operations) || value.operations.length === 0) issues.push("proposal.operations must be non-empty");
  else if (value.operations.length > MAX_OPERATIONS) issues.push(`proposal.operations exceeds ${MAX_OPERATIONS}`);
  else value.operations.forEach((operation, index) => validateOperation(operation, index, issues));

  if (Array.isArray(value.operations)) {
    const ids = value.operations.flatMap((operation) => isRecord(operation) && typeof operation.id === "string" ? [operation.id] : []);
    if (new Set(ids).size !== ids.length) issues.push("operation IDs must be unique");
    const knownIds = new Set(ids);
    const dependencies = new Map<string, string[]>();
    for (const operation of value.operations) {
      if (!isRecord(operation) || !Array.isArray(operation.dependsOn)) continue;
      const operationId = typeof operation.id === "string" ? operation.id : "";
      dependencies.set(operationId, operation.dependsOn.filter((dependency): dependency is string => typeof dependency === "string"));
      for (const dependency of operation.dependsOn) {
        if (typeof dependency === "string" && !knownIds.has(dependency)) issues.push(`operation ${String(operation.id)} has unknown dependency ${dependency}`);
        if (typeof dependency === "string" && dependency === operation.id) issues.push(`operation ${String(operation.id)} cannot depend on itself`);
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      const cyclic = (dependencies.get(id) ?? []).some(visit);
      visiting.delete(id);
      visited.add(id);
      return cyclic;
    };
    if (ids.some(visit)) issues.push("operation dependencies must not contain a cycle");
  }

  if (issues.length > 0) throw new ProtocolValidationError(issues);
  return value as unknown as Proposal;
}
