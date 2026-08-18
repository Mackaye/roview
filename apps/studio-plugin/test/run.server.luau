--!strict

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local modules = ReplicatedStorage:WaitForChild("RoviewModules")
local tests = script.Parent

local suites = {
	{ tests:WaitForChild("OperationOrder.spec"), require(modules:WaitForChild("OperationOrder")) },
	{ tests:WaitForChild("Policy.spec"), require(modules:WaitForChild("Policy")) },
	{ tests:WaitForChild("ReviewModel.spec"), require(modules:WaitForChild("ReviewModel")) },
	{
		tests:WaitForChild("CanonicalDigest.spec"),
		{
			CanonicalJson = require(modules:WaitForChild("CanonicalJson")),
			Sha256 = require(modules:WaitForChild("Sha256")),
		},
	},
	{
		tests:WaitForChild("ProtocolValidator.spec"),
		{
			CanonicalJson = require(modules:WaitForChild("CanonicalJson")),
			ProtocolValidator = require(modules:WaitForChild("ProtocolValidator")),
			Sha256 = require(modules:WaitForChild("Sha256")),
		},
	},
}

for _, suite in suites do
	local run = require(suite[1])
	run(suite[2])
end

print(`Roview Luau safety tests passed ({#suites} suites)`)
