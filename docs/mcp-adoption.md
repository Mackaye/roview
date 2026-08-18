# MCP adoption and product strategy

## Product position

Roblox creators should not have to replace the official Studio MCP to use Roview. Roblox ships the
connection, documents it, and can evolve it with Studio. Roview's durable advantage is the missing
human-control layer: understandable proposals, anchored feedback, exact-revision approval, stale-state
checks, and one undoable user-initiated apply.

The default product story is therefore:

```text
Official Roblox Studio MCP = eyes, context, navigation, and testing
Roview                     = review, approval, and controlled persistent change
```

This minimizes setup friction and avoids competing with Studio coverage that Roblox is best placed to
maintain.

## What we built from that strategy

### Dual-MCP onboarding

`pnpm setup:mcp` generates a normal Companion-mode configuration containing both official
`Roblox_Studio` and narrow `roview` entries. It preserves unrelated configured servers and refuses
silent replacement of conflicts.

### Non-overlapping tools

Roview owns only `review_changes` and `get_review`. Tool names communicate the boundary and do not
shadow official operations.

### Client policy packs

The setup tool emits rules for Codex, Claude, Cursor, Antigravity, or a generic client. The policy tells the agent
which server owns each phase, how feedback revisions work, and that browser approval never authorizes
an official direct mutation.

### Optional Safe Mode

Security-conscious teams can expose only `roview_safe`. Its gateway launches the official MCP but
forwards an audited allow-list of inspection and playtest tools. Persistent mutation and unknown tools
are absent rather than merely discouraged.

## Adoption principles

- Lead with a five-minute first success: connect, review, request one revision, approve, apply, undo.
- Keep Companion mode the recommended default; make Safe Mode an explicit team/security choice.
- Detect duplicate direct official connections in future packaged onboarding and warn clearly.
- Preserve source-control workflows. For Rojo or Script Sync projects, do not imply Roview replaces
  the filesystem source of truth.
- Treat safety as observable behavior: exact digest, refreshed preconditions, user apply, and one-step
  Undo/Redo.
- Avoid claiming integration inside Roblox Assistant until Roblox exposes a supported extension point.

## Known limits and next packaging work

The current setup is a developer CLI. A packaged release should add client auto-discovery, local
pairing and token rotation, duplicate-server detection, signed plugin distribution, Windows validation,
and telemetry only if creators explicitly opt in. Safe Mode currently forwards tools, not official
prompts/resources, and its allow-list must track official tool changes deliberately.

## Primary references

- [Roblox Studio MCP documentation](https://create.roblox.com/docs/studio/mcp)
- [Roblox Studio MCP reference implementation archive](https://github.com/Roblox/studio-rust-mcp-server)

Community feedback should continue to inform onboarding, but product and security claims should be
grounded in current official documentation and repeatable Studio tests.
