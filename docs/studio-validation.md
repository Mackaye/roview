# Studio validation

This is the repeatable manual gate for behavior that cannot be established by TypeScript or static
Luau checks. Keep evidence for each run: OS, Studio version/channel, plugin build revision, date,
fixture, observed result, Output log, and before/after screenshots.

Automated preparation:

```sh
pnpm install
pnpm build
pnpm test
pnpm check:luau
pnpm format:luau
pnpm build:plugin
pnpm build:studio-fixtures
```

Install the ignored `roview-plugin.rbxm` through **Studio → Plugins → Plugins Folder** and restart
Studio. The default plugin project is a Rojo model and must not be synced into a place DataModel.
The remaining command produces ignored `roview-demo.rbxlx`, `roview-plugin-tests.rbxlx`, and
`roview-safety-spikes.rbxm` files. Open the test place once and confirm Output reports that all
pure Luau safety suites passed.

## Five-minute smoke test

1. Start a clean demo companion:

   ```sh
   ROVIEW_DATA_PATH=/tmp/roview-smoke.json pnpm demo
   ```

2. Open `roview-demo.rbxlx`, open **Roview → Review changes**, paste the printed one-use pairing
   value, and click **Connect**.
3. Confirm Studio shows risk, affected services, producer, revision, digest prefix, operation count,
   Team Create/Drafts warning, and Rojo/external-source warning. The daily-reward fixture is high risk,
   so use **Open full review** and approve in the browser. Test native decisions separately with a
   low/medium-risk modest proposal.
4. Return to Studio. Within five seconds the primary action becomes **Apply 3 changes**. Click it.
5. Confirm the RemoteEvent, script, and button color changed. Use Undo once to restore all three, then
   Redo once to reapply all three.

That is the complete happy-path test. Continue below only when testing a particular safety invariant.

## Required matrix

Run every gate on current Roblox Studio for both macOS and Windows 11.

| Gate | Pass condition |
|---|---|
| Loopback permission and reconnect | Plugin connects before/after companion start without external-interface traffic |
| Current editor source | Unsaved editor buffer is hashed; stale replacement conflicts |
| Mixed apply and Undo/Redo | Daily reward fixture applies in one recording; one Undo restores all; one Redo reapplies all |
| 20-operation single Undo | All 20 folders appear; one Undo removes all 20 |
| Partial failure rollback | Failure on operation 3 of 5 leaves none of operations 1–2 applied |
| Ambiguous locator | Duplicate siblings produce `CONFLICTED`; neither sibling is selected |
| Play mode | Preflight refuses apply while Studio is running |
| Team Create/Drafts | Limitation is visible; no unsupported Draft control is claimed |
| Rojo-managed source | Overwrite behavior is recorded; high-stakes workflow recommends branch/local copy |
| UI scale | 500 operations and a 5,000-line diff remain responsive against documented budgets |
| Native review decisions | A modest proposal can be approved, rejected, or returned with a note; browser remains available |
| Lineage and safe selection | Revision 2 identifies revision 1, shows change context, and does not displace another selected pending proposal |
| Draft recovery | Global/operation/line comments and viewed progress survive refresh and companion restart |
| Pairing and rotation | One-use pairing works, a consumed value fails, rotation disconnects the old token, and re-pair recovers |
| Cursor polling | Unchanged polls transfer no proposal list; new decisions arrive without duplicate apply |
| Narrow/wide accessibility | Text labels remain legible at 320/480/720/1100 px; keyboard focus reaches every action |

## Fixture procedures

### Mixed apply and editor correctness

1. Open `roview-demo.rbxlx` with the built local Roview plugin installed, then run `pnpm demo`.
2. Open `DailyRewardsService` and change its current editor buffer without closing the editor.
3. Approve `daily-reward.json`. Apply must report a stale script conflict and create no remote or
   property change.
4. Restore the exact fixture source, resubmit with a new proposal ID, approve, and apply.
5. Confirm the remote, source, and button color all changed. Use Studio Undo once and confirm all
   three return to their original state; Redo once and confirm all three return.

### Ambiguous and stale targets

The safety-spike plugin creates two ReplicatedStorage children named `Duplicate`, verifies the
locator reports two matches without selecting either, then removes them. Its PASS message is the
ambiguity gate. Submit `stale-property.json` and `stale-script.json`; each must conflict before any
operation starts. The `ambiguous-locator.json` proposal is available for a full transport/preflight
repeat if the two duplicate folders are recreated in the Command Bar.

### Twenty-operation gate

Submit `twenty-operation.json`, approve, and apply. Confirm `RoviewFixture01` through
`RoviewFixture20` exist under ReplicatedStorage and share one history recording. One Undo must
remove all twenty; one Redo must restore all twenty.

### Partial failure and history harness

Install the ignored `roview-safety-spikes.rbxm` as a local plugin and click **Run safety spikes** in
edit mode. The harness injects an error immediately before operation 3 of 5, verifies reverse-order
rollback removed operations 1 and 2, then applies 20 operations and calls Studio Undo and Redo while
checking the DataModel after each step. Both PASS messages are required; capture any failure and Output.

### Team Create and Rojo

Repeat the stale-source flow in a Team Create place and against a Rojo-synced script. Record whether
the current editor buffer, DataModel source, and filesystem source disagree and which system wins
after sync. Roview must block or warn rather than infer Draft state through unsupported APIs.

### Native review, lineage, and inbox

1. Submit two different revision-1 proposals. Select the older one, wait for an unchanged poll, and
   confirm selection does not jump.
2. Request changes on one proposal with a Studio note. Submit revision 2 with
   `previousRevision: 1`, a changed plan, one changed operation, one added operation, and one removed
   operation.
3. Confirm revision 1 is shown as superseded, revision 2 is the only active tip, the lineage is
   explicit, and previous feedback remains visible in the full browser review.
4. Confirm approve/reject/request-changes controls are text-labelled, keyboard reachable, and disabled
   for large proposals that require full review.

### Draft recovery and stale-write protection

1. In the browser, add a global note, an operation comment, a line comment, and mark two items viewed.
2. Refresh the browser; confirm all draft state restores.
3. Stop and restart the companion using the same `ROVIEW_DATA_PATH`, reopen the review, and confirm
   restoration again.
4. Open the same review in two tabs. Save in tab A, decide the review in tab B, then edit tab A.
   Confirm the stale save is rejected and the terminal draft is not resurrected.
5. Expand **Agent feedback preview** and compare its proposal ID, revision, digest, and comments with
   the MCP result.

### Pairing, port conflict, and cursor polling

1. Pair once with the printed `http://127.0.0.1:<port>|<code>` value; confirm reusing it fails.
2. Occupy port 3219 before starting the companion. Confirm it selects another loopback port, writes
   PID/port/protocol/start time to `.roview/discovery.json`, and the pairing value connects Studio.
3. Rotate the token through the authenticated API. Confirm the old plugin session shows a reconnect
   state and requires intentional re-pairing after companion restart.
4. Leave the widget open with no changes for one minute and inspect companion traffic: cursor polls
   should return no proposal payload. Record decision latency after a browser approval.

All rows added above are **built but awaiting Studio evidence** on both macOS and Windows. Do not mark
them passed from Rojo build, Selene, or TypeScript HTTP tests alone.

## Result policy

Attach evidence before claiming a platform is compatible. A failure in editor correctness, rollback,
or Undo is a stop-ship result: narrow direct application to review/export until the constraint is
understood.

Evidence records must include: gate, PASS/FAIL/BLOCKED result, OS/version, Studio version/channel,
plugin artifact checksum or repository revision, companion command/data path, observed behavior,
redacted Output/log excerpt, screenshot/video paths, and follow-up issue.
