# 0.2 review-alpha implementation plan

Last updated: 2026-08-17

Current implementation status: phases 1–5 are implemented in the initial baseline; Phase 6 static,
build, and non-network unit gates are complete. Live Studio evidence and the sandbox-blocked loopback
HTTP test rerun remain outstanding. No commit has been created.

This plan moves Roview toward **Studio evidence and native review clarity** while preserving Studio
as the sole mutation authority. Ordinary proposals should be understandable and decidable in Studio;
the browser remains the expansion surface for large diffs, revision comparison, and dense feedback.

## Phase 1 — Baseline hygiene and safety audit

- Inventory source, generated, local, and private files; harden `.gitignore` without deleting data.
- Audit protocol, companion, browser, MCP, and Luau trust boundaries and state transitions.
- Fix concrete correctness, digest, preflight, idempotency, ordering, rollback, lifecycle, and security
  defects before adding product surface.
- Stage only reviewed source, fixtures, documentation, and lockfiles for the proposed initial baseline.

## Phase 2 — Revision lineage and inbox semantics

- Add explicit previous-revision lineage and prevent content reuse for an existing revision.
- Keep one active revision per lineage and preserve exact digest-bound decisions and prior feedback.
- Define deterministic inbox ordering, active revision selection, terminal visibility, supersession, and
  safe selection when records change.
- Add cross-runtime fixtures and tests for compatibility and lineage rules.

## Phase 3 — Durable browser review

- Persist global, operation, and line comments plus viewed progress by proposal/revision/digest.
- Use atomic saves, optimistic generations, and tombstones so stale writes cannot resurrect drafts.
- Restore drafts after refresh/restart, clean them after terminal decisions under a documented policy,
  and preview the exact structured feedback returned to an agent.
- Show revision changes and keep previous feedback inspectable.

## Phase 4 — Companion and plugin lifecycle

- Add a single-instance lock and discovery record with PID, port, protocol version, and start time.
- Handle preferred-port conflicts with an explicit loopback-only fallback and diagnostics.
- Add intentional pairing/token rotation with restricted local persistence; retain authenticated APIs.
- Replace repeated full-list polling with cursor-based, idempotent long polling and clear reconnect and
  protocol-mismatch states. Streaming remains a separately evidenced compatibility spike.

## Phase 5 — Native Studio review clarity

- Add deterministic risk, affected-service, destructive-change, source-of-truth, and collaboration
  warnings.
- Group operations by service/subtree and show readable create/change/delete and before/after values.
- Keep producer, revision, lineage, digest, operation count, review, preflight, conflict, apply, and
  result state visible in narrow and wide layouts.
- Provide keyboard-accessible, text-labelled approve/request-changes/reject controls for modest
  proposals while keeping **Open full review** for detailed work.

## Phase 6 — Verification, evidence, and handoff

- Add focused TypeScript and pure Luau tests for every implemented invariant.
- Run build, test, Luau lint/format, plugin build, and Studio-fixture build commands.
- Review the final diff as a production pull request and fix actionable findings.
- Update repository docs and canonical project notes with exact implemented/verified/awaiting/deferred
  status and current test counts.
- Present the staged baseline list and proposed commit structure; do not commit or publish.

## Safety constraints

- Browser decisions never mutate Studio.
- Studio independently verifies the exact approved digest and live preconditions.
- Locators, operation kinds, classes, properties, and tagged values remain fail-closed.
- Apply remains explicit, one-attempt/idempotent, Edit-mode-only, and non-replaying.
- No generated Luau execution, remote binding, hosted service, selective approval, or hidden Drafts
  behavior is introduced.
