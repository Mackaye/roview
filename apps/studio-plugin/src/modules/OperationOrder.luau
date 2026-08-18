--!strict

local OperationOrder = {}

local function priority(operation: any): number
	if operation.kind == "createInstance" then
		return 1
	elseif operation.kind == "setProperty" then
		return 2
	elseif operation.kind == "replaceScriptSource" then
		return 3
	end
	return 99
end

function OperationOrder.sort(operations: { any }): ({ any }?, string?)
	local byId = {}
	local indegree = {}
	local dependents = {}
	for _, operation in operations do
		byId[operation.id] = operation
		indegree[operation.id] = 0
		dependents[operation.id] = {}
	end
	for _, operation in operations do
		for _, dependency in operation.dependsOn or {} do
			if not byId[dependency] then
				return nil, `Operation {operation.id} depends on unknown operation {dependency}`
			end
			indegree[operation.id] += 1
			table.insert(dependents[dependency], operation.id)
		end
	end
	local ready = {}
	for id, count in indegree do
		if count == 0 then
			table.insert(ready, id)
		end
	end
	local ordered = {}
	while #ready > 0 do
		table.sort(ready, function(leftId: string, rightId: string)
			local left, right = byId[leftId], byId[rightId]
			if priority(left) == priority(right) then
				return leftId < rightId
			end
			return priority(left) < priority(right)
		end)
		local id = table.remove(ready, 1)
		table.insert(ordered, byId[id])
		for _, dependent in dependents[id] do
			indegree[dependent] -= 1
			if indegree[dependent] == 0 then
				table.insert(ready, dependent)
			end
		end
	end
	if #ordered ~= #operations then
		return nil, "Operation dependencies contain a cycle"
	end
	return ordered, nil
end

return OperationOrder
