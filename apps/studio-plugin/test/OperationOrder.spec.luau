--!strict

return function(OperationOrder: any)
	local ordered, orderError = OperationOrder.sort({
		{ id = "script", kind = "replaceScriptSource", dependsOn = { "folder" } },
		{ id = "property", kind = "setProperty" },
		{ id = "folder", kind = "createInstance" },
	})
	assert(orderError == nil, tostring(orderError))
	assert(ordered ~= nil, "ordering should succeed")
	assert(ordered[1].id == "folder", "dependency must be ordered before its consumer")
	assert(ordered[2].id == "property", "priority must provide a deterministic tie-break")
	assert(ordered[3].id == "script", "dependent script should be last")

	local cyclic, cycleError = OperationOrder.sort({
		{ id = "a", kind = "createInstance", dependsOn = { "b" } },
		{ id = "b", kind = "createInstance", dependsOn = { "a" } },
	})
	assert(cyclic == nil, "cycles must not produce an order")
	assert(cycleError == "Operation dependencies contain a cycle", "cycle should return an actionable error")
end
