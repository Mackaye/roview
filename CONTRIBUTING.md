# Contributing to Roview

Roview is a safety boundary for privileged Roblox Studio changes. Contributions should preserve its
fail-closed behavior and keep reviewed data identical to applied data.

## Development setup

### Requirements

- **Core & Companion Development** (TypeScript, MCP, Webview, CLI): Node.js 22+, pnpm.
- **Studio Plugin Development** (Luau source in `apps/studio-plugin/`): Rojo, Selene, and StyLua.

### Commands

```sh
# TypeScript / Companion / MCP
pnpm install
pnpm build
pnpm test

# Luau Plugin & Fixtures (requires Selene, StyLua, Rojo)
pnpm check:luau
pnpm format:luau
pnpm build:plugin
pnpm build:studio-fixtures
```

Run `pnpm demo`, enable Studio HTTP requests, install or serve
`apps/studio-plugin/default.project.json` through Rojo, and connect with the one-time token printed by
the companion.

## Change requirements

- Add a fixture and contract test for protocol changes.
- Add a Studio reproduction for executor, preflight, locator, or history changes.
- Do not relax operation, class, property, or value policies without an ADR explaining the threat model.
- Never log proposal source or session tokens.
- Keep generated files and local `.roview/` review data out of commits.
- Describe which operating systems and Studio versions were tested.

Protocol and executor changes should receive two-person review when maintainership permits. By
submitting a contribution, you agree that it is licensed under Apache-2.0.
