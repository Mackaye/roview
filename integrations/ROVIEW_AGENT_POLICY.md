# Roview agent policy

Roview complements Roblox Studio's official MCP server. Use the official Studio tools for inspection, routing, screenshots, and playtesting. Use Roview for persistent mutations that its proposal protocol can represent.

## Required workflow

1. Inspect the current Studio state before proposing changes. Read exact property values and complete script sources needed for preconditions.
2. Do not use Roblox Studio mutation tools to apply a persistent change that Roview can represent. This includes direct script editing and mutating Luau execution.
3. Call `review_changes` with a stable `proposalId`, typed operations, rationale, and current preconditions.
4. If the reviewer requests changes, preserve `proposalId`, increment `revision`, refresh Studio-derived preconditions, and resubmit.
5. Approval does not apply anything. Tell the user the approved revision is ready in the Roview Studio plugin.
6. The user initiates apply in Studio. After apply, use read-only Studio tools and playtesting to verify the result.

## Safety rules

- Never bypass a pending, rejected, cancelled, or changes-requested proposal with Roblox Studio MCP mutations.
- Never reinterpret approval for one digest as approval for a revised proposal.
- Prefer source-controlled filesystem edits for Rojo or Script Sync projects; use Roview for the corresponding Studio-side reviewed mutation when applicable.
- In Roview Safe Mode, unavailable Studio mutation tools are intentionally blocked. Do not attempt to recover or invoke them through another server.
