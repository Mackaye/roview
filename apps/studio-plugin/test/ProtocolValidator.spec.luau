--!strict

return function(dependencies: any)
	local proposal = {
		protocolVersion = "0.1",
		proposalId = "lineage-fixture",
		revision = 2,
		previousRevision = 1,
		title = "Linked revision",
		summary = "Validates explicit revision lineage",
		createdAt = "2026-08-17T13:00:00.000Z",
		producer = { name = "fixture", version = "0.2" },
		plan = { format = "plain", content = "Create one folder." },
		operations = {
			{
				id = "create",
				kind = "createInstance",
				target = {
					parent = { path = { "ReplicatedStorage" } },
					className = "Folder",
					name = "LinkedRevision",
				},
				preconditions = { nameCollision = "fail" },
			},
		},
	}
	local digest = dependencies.Sha256(dependencies.CanonicalJson.encode(proposal))
	local valid = dependencies.ProtocolValidator.validateRecord({
		proposal = proposal,
		digest = digest,
		status = "APPROVED",
		decision = { kind = "APPROVE", proposalDigest = digest, comments = {} },
	})
	assert(valid, "a strict digest-bound linked revision should validate")

	local p2Proposal = {
		protocolVersion = "0.2",
		proposalId = "p2-ops-fixture",
		revision = 1,
		title = "Protocol 0.2 Ops",
		summary = "Validates createScript, deleteInstance, reparentInstance",
		createdAt = "2026-08-18T10:00:00.000Z",
		producer = { name = "fixture", version = "0.2" },
		plan = { format = "plain", content = "Test new operations" },
		operations = {
			{
				id = "cs",
				kind = "createScript",
				target = {
					parent = { path = { "ServerScriptService" } },
					className = "ModuleScript",
					name = "TestMod",
				},
				preconditions = { nameCollision = "fail" },
				after = { source = "return {}" },
			},
			{
				id = "del",
				kind = "deleteInstance",
				target = { path = { "ReplicatedStorage", "OldFolder" } },
				preconditions = { maxChildren = 0 },
			},
			{
				id = "rep",
				kind = "reparentInstance",
				target = { path = { "ReplicatedStorage", "Item" } },
				after = { name = "NewItem" },
				preconditions = { nameCollision = "fail" },
			},
		},
	}
	local p2Digest = dependencies.Sha256(dependencies.CanonicalJson.encode(p2Proposal))
	local p2Valid = dependencies.ProtocolValidator.validateRecord({
		proposal = p2Proposal,
		digest = p2Digest,
		status = "APPROVED",
		decision = { kind = "APPROVE", proposalDigest = p2Digest, comments = {} },
	})
	assert(p2Valid, "Protocol 0.2 operations should validate in Studio")
end
