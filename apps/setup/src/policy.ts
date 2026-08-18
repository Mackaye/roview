import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PolicyClient =
  | "antigravity"
  | "cursor"
  | "claude"
  | "windsurf"
  | "cline"
  | "roo"
  | "codex"
  | "generic";

export const ROVIEW_AGENT_POLICY = `# Roview agent policy

Roview complements Roblox Studio's official MCP server. Use the official Studio tools for inspection, routing, screenshots, and playtesting. Use Roview for persistent mutations that its proposal protocol can represent.

## Required workflow

1. Inspect the current Studio state before proposing changes. Read exact property values and complete script sources needed for preconditions.
2. Do not use Roblox Studio mutation tools to apply a persistent change that Roview can represent. This includes direct script editing and mutating Luau execution.
3. Call \`review_changes\` with a stable \`proposalId\`, typed operations, rationale, and current preconditions.
4. If the reviewer requests changes, preserve \`proposalId\`, increment \`revision\`, set \`previousRevision\`, refresh Studio-derived preconditions, and resubmit.
5. Approval does not apply anything. Tell the user the approved revision is ready in the Roview Studio plugin.
6. The user initiates apply in Studio. After apply, use read-only Studio tools and playtesting to verify the result.

## Supported operations (\`review_changes\`)

- \`createScript\`: Creates a \`Script\`, \`LocalScript\`, or \`ModuleScript\` with its initial Luau source code under a parent locator in one atomic operation.
- \`replaceScriptSource\`: Modifies an existing script with a SHA-256 hash precondition of the current script body.
- \`setProperty\`: Modifies allow-listed properties (\`Name\`, \`Value\`, \`Visible\`, \`Enabled\`, \`BackgroundColor3\`, \`TextColor3\`, \`LayoutOrder\`) using tagged values.
- \`createInstance\`: Creates non-script instances (\`Folder\`, \`Configuration\`, \`RemoteEvent\`, \`RemoteFunction\`, \`BindableEvent\`, \`BindableFunction\`).
- \`deleteInstance\`: Safely removes an instance (guards against root service deletion; supports \`className\` and \`maxChildren\` preconditions).
- \`reparentInstance\`: Moves and/or renames an instance under a new parent locator.

## Safety rules

- Never bypass a pending, rejected, cancelled, or changes-requested proposal with Roblox Studio MCP mutations.
- Never reinterpret approval for one digest as approval for a revised proposal.
- Prefer source-controlled filesystem edits for Rojo or Script Sync projects; use Roview for the corresponding Studio-side reviewed mutation when applicable.
- In Roview Safe Mode, unavailable Studio mutation tools are intentionally blocked. Do not attempt to recover or invoke them through another server.
`;

export const policyRelativePath = (client: PolicyClient) => {
  if (client === "antigravity") return join(".gemini", "rules", "roview.md");
  if (client === "cursor") return join(".cursor", "rules", "roview.mdc");
  if (client === "claude") return "CLAUDE.roview.md";
  if (client === "windsurf") return ".windsurfrules";
  if (client === "cline") return ".clinerules";
  if (client === "roo") return ".roomodes";
  if (client === "codex") return "AGENTS.roview.md";
  return "ROVIEW_AGENT_POLICY.md";
};

export async function writePolicyPack(targetDirectory: string, client: PolicyClient) {
  const path = join(targetDirectory, policyRelativePath(client));
  await mkdir(dirname(path), { recursive: true });
  const header = client === "cursor"
    ? "---\ndescription: Require Roview review for Roblox Studio mutations\nalwaysApply: true\n---\n\n"
    : "";
  await writeFile(path, `${header}${ROVIEW_AGENT_POLICY}`, { encoding: "utf8", mode: 0o600 });
  return path;
}

