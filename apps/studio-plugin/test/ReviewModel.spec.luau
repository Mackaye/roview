--!strict

return function(ReviewModel: any)
	local summary = ReviewModel.summarize({
		operations = {
			{
				id = "remote",
				kind = "createInstance",
				target = {
					parent = { path = { "ReplicatedStorage", "Remotes" } },
					className = "RemoteEvent",
					name = "Claim",
				},
			},
			{
				id = "property",
				kind = "setProperty",
				target = { path = { "StarterGui", "Screen", "Button" } },
				property = "Visible",
				before = { type = "boolean", value = false },
				after = { type = "boolean", value = true },
			},
		},
	})
	assert(summary.risk == "high", "RemoteEvent creation should be high review risk")
	assert(table.concat(summary.services, ",") == "ReplicatedStorage,StarterGui", "services should be sorted")
	assert(
		ReviewModel.operationIndicator(summary.groups["StarterGui/Screen"][1]) == "CHANGE",
		"property operations should use a non-colour-only CHANGE indicator"
	)

	local diffTokens = ReviewModel.diffLines("local x = 1\nreturn x", "local x = 2\nreturn x")
	assert(#diffTokens == 3, "should produce 3 diff line tokens")
	assert(diffTokens[1].kind == "removed" and diffTokens[1].text == "local x = 1", "first line removed")
	assert(diffTokens[2].kind == "added" and diffTokens[2].text == "local x = 2", "second line added")
	assert(diffTokens[3].kind == "context" and diffTokens[3].text == "return x", "third line context")

	local aligned = ReviewModel.alignedDiff(
		{ "local a = 1", "local b = 2", "print(a)" },
		{ "local a = 1", "local b = 99", "local c = 3", "print(a)" }
	)
	assert(#aligned == 4, "aligned diff should have 4 rows")
	assert(aligned[1].before ~= nil and aligned[1].after ~= nil, "row 1 context on both sides")
	assert(
		aligned[1].before.text == "local a = 1" and aligned[1].after.text == "local a = 1",
		"row 1 text match"
	)
	assert(aligned[2].before ~= nil and aligned[2].before.kind == "removed", "row 2 before removed")
	assert(aligned[2].after ~= nil and aligned[2].after.kind == "added", "row 2 after added")
	assert(aligned[3].before == nil, "row 3 before is empty placeholder slot")
	assert(aligned[3].after ~= nil and aligned[3].after.text == "local c = 3", "row 3 after added")
	assert(aligned[4].before ~= nil and aligned[4].after ~= nil, "row 4 context on both sides")

	local highlighted = ReviewModel.highlightLuau('local foo = "bar" -- greeting')
	assert(string.find(highlighted, 'font color="#FF7B72"') ~= nil, "keywords should be highlighted")
	assert(string.find(highlighted, 'font color="#A5D6FF"') ~= nil, "strings should be highlighted")
	assert(string.find(highlighted, 'font color="#8B949E"') ~= nil, "comments should be highlighted")

	local escaped = ReviewModel.highlightLuau("if a < b and c > d then")
	assert(string.find(escaped, "&lt;") ~= nil, "< should be escaped to &lt;")
	assert(string.find(escaped, "&gt;") ~= nil, "> should be escaped to &gt;")

	local opSources = ReviewModel.operationSources({
		kind = "setProperty",
		property = "Size",
		before = { type = "Vector3", x = 1, y = 2, z = 3 },
		after = { type = "Vector3", x = 4, y = 5, z = 6 },
	})
	assert(opSources.before ~= nil and opSources.after ~= nil, "opSources returns before and after")
	local items = ReviewModel.createItems({
		proposal = {
			plan = { content = "# Title\n- Bullet 1" },
			operations = {
				{
					id = "op1",
					kind = "replaceScriptSource",
					target = { path = { "ServerScriptService", "Auth" } },
					before = { source = "local x = 1" },
					after = { source = "local x = 2\nlocal y = 3" },
				},
			},
		},
	})
	assert(#items == 2, "createItems should include plan.md and op1")
	assert(items[1].key == "plan" and items[1].label == "plan.md", "first item is plan.md")
	assert(items[2].icon == "📜", "script operation has script icon")

	local stats = ReviewModel.statsForItem(items[2], nil)
	assert(stats.added == 2 and stats.removed == 1, "statsForItem counts additions and deletions")

	local mdHighlight = ReviewModel.highlightMarkdown("# Major Plan")
	assert(string.find(mdHighlight, 'font color="#79B8FF"') ~= nil, "markdown header highlighted")
end
