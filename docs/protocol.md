# Proposal protocol

Current wire version: **`0.2` draft** (with backward compatibility for `0.1` proposals)

The TypeScript definitions in `packages/protocol/src/types.ts` and parser in
`packages/protocol/src/validate.ts` are authoritative. The Studio plugin independently checks the
version, operation policy, dependencies, canonical SHA-256 digest, locators, and live preconditions.

## Compatibility

- Consumers accept only an exact supported `protocolVersion` (`"0.1"` or `"0.2"`).
- Adding an operation, tagged value, creatable class, or mutable property requires fixtures and
  validation in both TypeScript and Luau.
- Changes to canonical encoding, locator meaning, preconditions, defaults, or executor semantics
  require a new protocol version.
- Producers must not reuse the same `proposalId` and `revision` for changed content.
- Revision 1 omits `previousRevision`; every later revision names an existing earlier revision in
  the same proposal lineage. The companion accepts only the active lineage tip, preventing forks or
  title/date-based guesses.
- Empty optional arrays must be omitted because decoded empty Luau tables do not reliably preserve
  JSON array/object identity.

Canonical JSON sorts object keys lexically, preserves array order, uses compact JSON primitives, and
hashes the UTF-8 bytes with SHA-256.

## Supported operations

### `createInstance`

Creates one instance under a reviewed parent. The class must be in `allowedCreateClasses` (`Folder`, `Configuration`, `BindableEvent`, `BindableFunction`, `RemoteEvent`, `RemoteFunction`) and name collisions always fail.

### `createScript`

Creates a new `Script`, `LocalScript`, or `ModuleScript` under a reviewed parent with its initial Luau source code in one atomic operation.

### `setProperty`

Changes one explicitly allowed property. Before and after values use the same tagged type, and the
current Studio value must equal the reviewed before value.

### `replaceScriptSource`

Replaces the current `ScriptEditorService` source only when its SHA-256 digest matches the reviewed
precondition.

### `deleteInstance`

Removes an existing instance at the target locator. Preconditions can specify an expected `className` and an optional `maxChildren` count. Top-level Roblox services cannot be deleted.

### `reparentInstance`

Moves and/or renames an existing instance to a new parent locator. Verifies destination availability and prevents self-descendant cycle parenting. Top-level services cannot be reparented.

Unknown fields, operations, classes, properties, tagged values, missing dependencies, dependency
cycles, and stale targets are rejected rather than ignored.

## Lifecycle

```text
READY_FOR_REVIEW → APPROVED → PREFLIGHT → APPLYING → APPLIED
                       └──────→ CONFLICTED
                                  └────────→ APPLY_FAILED
```

`REJECTED`, `CHANGES_REQUESTED`, and `CANCELLED` revisions cannot apply. An interrupted
`APPLYING` record recovers to `APPLY_FAILED`; Roview never automatically replays it.

Submitting a linked revision changes its previous active tip to `SUPERSEDED`. Its exact proposal,
digest, decision, and feedback remain inspectable. A lineage whose active tip has entered an apply
attempt cannot be revised.

## Inbox ordering and selection

The companion returns a deterministic inbox:

1. actionable records (`READY_FOR_REVIEW`, `APPROVED`, `PREFLIGHT`, `APPLYING`);
2. attention records (`CONFLICTED`, `APPLY_FAILED`);
3. terminal review/history records;
4. superseded and cancelled records.

Within a group, unread records sort before reviewed records, then by creation time descending,
proposal ID, and revision. Opening a revision in the browser records `reviewedAt`; per-item viewed
progress remains in the digest-bound draft. Studio
preserves the currently selected proposal when it still exists; otherwise it chooses the first
actionable record and only then the first historical record. Multiple pending proposal lineages are
visible. Superseded revisions remain history and never become apply candidates.

## Review drafts

Browser drafts are keyed by proposal ID, revision, and proposal digest. They contain global comments,
operation/line comments, and viewed item IDs. Each atomic write carries an expected generation.
Deletion writes a tombstone with the next generation, so a delayed browser save cannot resurrect a
deleted or terminal draft. A terminal decision clears content to a tombstone. Tombstones follow the
same local store retention boundary as their proposal history.

## Changelog

### 0.2 draft

- Added `createScript` operation supporting atomic creation of `Script`, `LocalScript`, and `ModuleScript` with initial Luau source.
- Added `deleteInstance` operation with class precondition, child count constraint (`maxChildren`), and root service deletion protection.
- Added `reparentInstance` operation for moving and renaming instances with cycle prevention.
- Added companion web review rendering for script creation, instance deletions, and reparenting diffs.

### 0.1 draft

- Canonical proposal digest.
- Whole-revision decisions and operation/line comments.
- Preflight and apply lifecycle records.
- Explicit create-class and property/tag policies.
- Dependency existence, self-dependency, and cycle rejection.
- Eleven representative fixtures and a shared TypeScript/Luau digest vector.
- Explicit `previousRevision` lineage, single active tips, and `SUPERSEDED` history.
- Generation-guarded digest-bound browser drafts and deterministic inbox ordering.

