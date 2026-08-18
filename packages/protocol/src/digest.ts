import { createHash } from "node:crypto";

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
  return `{${entries.join(",")}}`;
}

export function proposalDigest(proposal: unknown) {
  return createHash("sha256").update(canonicalize(proposal), "utf8").digest("hex");
}

export const canonicalJson = canonicalize;
