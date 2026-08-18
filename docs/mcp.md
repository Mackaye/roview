# Roview MCP setup and workflow

Roview is a review companion for Roblox Studio's official MCP, not a replacement for it. The
official server supplies rich Studio inspection and playtesting. Roview owns the narrow proposal,
human-feedback, approval, and user-initiated apply boundary.

## Choose a mode

| Mode | MCP entries visible to the AI client | Best for | Enforcement |
| --- | --- | --- | --- |
| Companion (recommended) | `Roblox_Studio` and `roview` | Most creators; full official Studio capability with a review workflow | Policy/instructions prevent bypass; client permissions remain available |
| Safe Mode | `roview_safe` only | Teams that prefer stronger guardrails over complete Studio automation | Gateway omits official persistent-mutation and unknown tools |

Do not enable both modes at once. In particular, a direct `Roblox_Studio` entry beside
`roview_safe` would let an agent bypass the gateway.

## Responsibility split

| Component | Responsibility |
| --- | --- |
| Roblox Studio MCP | Inspect the place, read scripts, navigate, capture screenshots, and playtest. |
| Roview MCP | Submit typed proposals, wait for human review, and return approval or anchored feedback. |
| Roview companion | Persist revisions, serve browser review, and enforce the review state machine. |
| Roview Studio plugin | Recompute the digest, preflight live state, and perform one user-initiated undoable apply. |

Approval in the browser is not permission for an agent to call an official Studio mutation tool. It
only permits the Roview plugin to begin its independent Studio preflight.

## Current Roview tools

### `review_changes`

Submits a protocol `0.1` proposal and waits for up to `waitSeconds` for a decision. It opens the
browser review automatically. The result is one of:

- `APPROVED` — Studio may preflight the exact digest;
- `CHANGES_REQUESTED` — anchored/general comments return directly to the model with the next revision;
- `REJECTED` or `CANCELLED` — the model is instructed to stop;
- `PENDING` — the durable proposal remains available and the model can call `get_review`.

An identical retry of the same ID, revision, and content is idempotent; `createdAt` may be regenerated
by the adapter. Changed plan or operation content must use a new revision. Revision 1 omits
`previousRevision`; every later `review_changes` call must set it to the exact active revision being
revised. Agents allocate a stable `proposalId` before the first call so a timeout is safely retryable.

### `get_review`

Reads an existing decision immediately or waits for a bounded period. This resumes a review after an
MCP timeout without losing the proposal or feedback.

These two names deliberately do not overlap the official Roblox Studio tool names.

## Start the local components

Generate one high-entropy token per development session:

```sh
openssl rand -hex 32
```

Start the companion:

```sh
ROVIEW_TOKEN='<generated token>' pnpm start
```

The AI client launches the selected MCP process itself. Do not separately run `pnpm mcp` or
`pnpm mcp:safe` unless debugging stdio.

## Setup generator

Roview includes an interactive setup CLI with auto-detection for installed AI tooling (including Antigravity, Cursor, Claude Code / Desktop, Windsurf, Cline, Roo Code, and Codex).

Run the interactive setup wizard:

```sh
pnpm setup:mcp
```

This scans for local agent configurations, presents an interactive multi-selection menu, and automatically writes the appropriate MCP settings and agent policy packs.

### Non-interactive or targeted client setup

Preview a ready-to-merge JSON configuration for Companion mode:

```sh
pnpm setup:mcp -- \
  --client antigravity \
  --mode companion \
  --token '<same generated token>' \
  --project-root /absolute/path/to/roview
```

For JSON-based MCP clients, merge it atomically into an existing config without replacing unrelated
servers:

```sh
pnpm setup:mcp -- \
  --client cursor \
  --mode companion \
  --token '<same generated token>' \
  --project-root /absolute/path/to/roview \
  --config /absolute/path/to/mcp.json \
  --apply
```

The setup command refuses to overwrite a conflicting `Roblox_Studio`, `roview`, or
`roview_safe` entry unless `--force` is explicit. The generated development config contains the
local session token, so keep that file user-readable only and never commit it. Applying Safe Mode
removes direct `Roblox_Studio` and normal `roview` entries; switching back to Companion mode removes
`roview_safe`. Unrelated MCP servers are preserved.

Generate client-specific agent rules at the same time:

```sh
pnpm setup:mcp -- \
  --clients antigravity,cursor \
  --mode companion \
  --token '<same generated token>' \
  --policy-target /absolute/path/to/your/roblox-game
```

This writes the appropriate rules file for each client:
- **Antigravity**: `.gemini/rules/roview.md`
- **Cursor**: `.cursor/rules/roview.mdc`
- **Claude**: `CLAUDE.roview.md`
- **Windsurf**: `.windsurfrules`
- **Cline**: `.clinerules`
- **Roo Code**: `.roomodes`
- **Codex**: `AGENTS.roview.md`
- **Generic**: `ROVIEW_AGENT_POLICY.md`

Run `--doctor` while the companion is running to check companion health and local official MCP
discovery.

## Companion mode

Companion mode is the product default. Keep both generated entries enabled:

```text
Roblox_Studio → official inspection, navigation, and playtesting
roview        → review_changes and get_review
```

For Codex, the Roview entry can also be registered directly:

```sh
codex mcp add roview \
  --env ROVIEW_TOKEN='<same generated token>' \
  --env ROVIEW_URL='http://127.0.0.1:3219' \
  -- pnpm --dir /absolute/path/to/roview mcp
```

Enable Roblox Studio's official server through **Assistant → … → Manage MCP Servers** and its client
quick-connect flow. See Roblox's [official Studio MCP guide](https://create.roblox.com/docs/studio/mcp).

Companion mode is intentionally cooperative: it provides clear tool separation, server instructions,
and a project policy pack, but the AI client can still expose official mutation tools. Use Safe Mode
when that bypass must be technically unavailable.

## Safe Mode gateway

Generate a single-server config:

```sh
pnpm setup:mcp -- \
  --client cursor \
  --mode safe \
  --token '<same generated token>' \
  --project-root /absolute/path/to/roview
```

Safe Mode starts Roblox's official local MCP as a child process and forwards only an explicit
allow-list:

- script reading and search;
- DataModel search, inspection, and Studio state;
- console output and screen capture;
- Studio selection/routing;
- play start/stop, character navigation, keyboard, and mouse input;
- official HTTP GET and skill/context helpers.

It does not expose `multi_edit`, `execute_luau`, generation tools, or any new/unknown official tool.
The allow-list is deny-by-default, so upstream additions require a deliberate Roview code change
and test before becoming callable.

Safe Mode currently proxies tools only, not official MCP prompts or resources. It supports the
official macOS and Windows launch locations. Custom installations can set
`ROVIEW_STUDIO_MCP_COMMAND` and a JSON string array in `ROVIEW_STUDIO_MCP_ARGS`.

## Expected agent workflow

1. Inspect Studio with official read tools.
2. Read complete script sources and exact values needed for preconditions.
3. Compute lowercase SHA-256 source preconditions for script replacement.
4. Call `review_changes` with typed operations and rationale.
5. On feedback, keep `proposalId`, increment `revision`, set `previousRevision` to the reviewed
   revision, refresh live preconditions, and resubmit.
6. On approval, tell the user the revision is ready in the Roview Studio plugin.
7. The user applies it in Studio; the agent then verifies with read tools and playtesting.

## Inspector troubleshooting

MCP Inspector does not inherit the environment of a nested ad-hoc command reliably. Pass variables
with Inspector's `-e` options:

```sh
npx @modelcontextprotocol/inspector \
  -e ROVIEW_TOKEN='<same generated token>' \
  -e ROVIEW_URL='http://127.0.0.1:3219' \
  pnpm --dir /absolute/path/to/roview mcp
```

After connecting the server, select **Tools**, choose `review_changes`, fill the proposal fields, and
execute it. Browser feedback appears in the tool result. A changed resubmission keeps `proposalId`,
increments `revision`, and refreshes Studio-derived preconditions.

## Privacy and safety

- Roview uses stdio and authenticated requests to the loopback companion only.
- It rejects non-loopback `ROVIEW_URL` values.
- The bearer token is not included in tool results or model-visible review URLs.
- Proposal content and reviewer feedback return to the calling model as part of the workflow.
- MCP submission cannot invoke Studio apply, allocate an apply attempt, or bypass Studio validation.
- Safe Mode narrows AI-visible tools, but it is not an OS sandbox and does not defend a compromised
  machine, client, Studio installation, or malicious plugin.

The development companion now writes a permission-restricted `.roview/discovery.json` containing
PID, loopback port, protocol version, and start time, and enforces a data-directory single-instance
lock. Studio uses the one-use high-entropy pairing value printed at startup; this also carries a safe
fallback loopback port. Authenticated token rotation is available at `POST /v1/token/rotate`.
Pairing/discovery are implemented but await live macOS/Windows Studio evidence and packaged
clean-machine validation.
