--!strict

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local ChangeExecutor = require(script.modules.ChangeExecutor)
local LocatorResolver = require(script.modules.LocatorResolver)

local PREFIX = "RoviewSpike"

local function cleanup()
	for _, child in ReplicatedStorage:GetChildren() do
		if string.sub(child.Name, 1, #PREFIX) == PREFIX or child:GetAttribute("RoviewSpike") == true then
			child:Destroy()
		end
	end
end

local function verifyAmbiguousLocator()
	for _ = 1, 2 do
		local duplicate = Instance.new("Folder")
		duplicate.Name = "Duplicate"
		duplicate:SetAttribute("RoviewSpike", true)
		local flag = Instance.new("BoolValue")
		flag.Name = "Flag"
		flag.Parent = duplicate
		duplicate.Parent = ReplicatedStorage
	end
	local target, resolveError = LocatorResolver.resolve({
		path = { "ReplicatedStorage", "Duplicate", "Flag" },
		className = "BoolValue",
	})
	assert(target == nil, "ambiguous locator must not select a target")
	assert(
		string.find(resolveError or "", "found 2", 1, true) ~= nil,
		resolveError or "ambiguous locator returned no error"
	)
	print("PASS: duplicate sibling locator failed closed")
	cleanup()
end

local function proposal(id: string, count: number): any
	local operations = {}
	for index = 1, count do
		table.insert(operations, {
			id = string.format("create_%02d", index),
			kind = "createInstance",
			target = {
				parent = { path = { "ReplicatedStorage" }, className = "ReplicatedStorage" },
				className = "Folder",
				name = string.format("%s%02d", PREFIX, index),
			},
			preconditions = { parentClass = "ReplicatedStorage", nameCollision = "fail" },
		})
	end
	return {
		protocolVersion = "0.1",
		proposalId = id,
		revision = 1,
		title = "Roview safety spike",
		operations = operations,
	}
end

local function expectFolders(count: number, present: boolean)
	for index = 1, count do
		local found = ReplicatedStorage:FindFirstChild(string.format("%s%02d", PREFIX, index)) ~= nil
		assert(found == present, string.format("folder %d presence was %s", index, tostring(found)))
	end
end

local function run()
	assert(not RunService:IsRunning(), "Run safety spikes in Studio edit mode")
	cleanup()
	verifyAmbiguousLocator()

	local partialSuccess, partialMessage =
		ChangeExecutor.apply(proposal("partial_failure", 5), { failAtOperation = 3 })
	assert(not partialSuccess, "fault-injected apply must fail")
	assert(string.find(partialMessage, "Injected safety%-spike failure") ~= nil, partialMessage)
	expectFolders(5, false)
	print("PASS: operation 3 of 5 failure rolled back operations 1 and 2")

	local twentySuccess, twentyMessage = ChangeExecutor.apply(proposal("twenty_operation", 20))
	assert(twentySuccess, twentyMessage)
	expectFolders(20, true)
	ChangeHistoryService:Undo()
	expectFolders(20, false)
	ChangeHistoryService:Redo()
	expectFolders(20, true)
	print("PASS: 20 operations applied, Undid, and Redid as one history action")
	cleanup()
end

local toolbar = plugin:CreateToolbar("Roview Safety")
local button =
	toolbar:CreateButton("Run safety spikes", "Run rollback and single-Undo validation", "rbxassetid://0")
button.Click:Connect(function()
	local success, message = pcall(run)
	if not success then
		warn(`FAIL: {tostring(message)}`)
	end
end)
