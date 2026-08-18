--!strict

local CanonicalJson = require(script.Parent.CanonicalJson)
local OperationOrder = require(script.Parent.OperationOrder)
local Policy = require(script.Parent.Policy)
local Sha256 = require(script.Parent.Sha256)

local ProtocolValidator = {}

local function fail(message: string): (boolean, string)
	return false, message
end

local function nonEmptyString(value: any): boolean
	return typeof(value) == "string" and #value > 0
end

local function hasOnlyFields(value: any, fields: { [string]: boolean }): boolean
	if typeof(value) ~= "table" then
		return false
	end
	for key in value do
		if typeof(key) ~= "string" or not fields[key] then
			return false
		end
	end
	return true
end

local function validLocator(locator: any): boolean
	if
		typeof(locator) ~= "table"
		or not hasOnlyFields(locator, { path = true, className = true })
		or typeof(locator.path) ~= "table"
		or #locator.path == 0
	then
		return false
	end
	for _, segment in locator.path do
		if not nonEmptyString(segment) then
			return false
		end
	end
	return locator.className == nil or nonEmptyString(locator.className)
end

local function validTaggedValue(value: any): boolean
	if typeof(value) ~= "table" or not nonEmptyString(value.type) then
		return false
	end
	if value.type == "boolean" then
		return hasOnlyFields(value, { type = true, value = true }) and typeof(value.value) == "boolean"
	elseif value.type == "number" then
		return hasOnlyFields(value, { type = true, value = true }) and typeof(value.value) == "number"
	elseif value.type == "string" then
		return hasOnlyFields(value, { type = true, value = true }) and typeof(value.value) == "string"
	elseif value.type == "Color3" then
		return hasOnlyFields(value, { type = true, r = true, g = true, b = true })
			and typeof(value.r) == "number"
			and typeof(value.g) == "number"
			and typeof(value.b) == "number"
			and value.r >= 0
			and value.r <= 1
			and value.g >= 0
			and value.g <= 1
			and value.b >= 0
			and value.b <= 1
	elseif value.type == "Vector3" then
		return hasOnlyFields(value, { type = true, x = true, y = true, z = true })
			and typeof(value.x) == "number"
			and typeof(value.y) == "number"
			and typeof(value.z) == "number"
	elseif value.type == "Enum" then
		return hasOnlyFields(value, { type = true, enum = true, item = true })
			and nonEmptyString(value.enum)
			and nonEmptyString(value.item)
	end
	return false
end

local function validDependencies(operation: any): boolean
	if operation.dependsOn == nil then
		return true
	end
	if typeof(operation.dependsOn) ~= "table" or #operation.dependsOn == 0 then
		return false
	end
	for _, dependency in operation.dependsOn do
		if not nonEmptyString(dependency) then
			return false
		end
	end
	return true
end

local function validateOperation(operation: any): (boolean, string)
	if
		typeof(operation) ~= "table"
		or not nonEmptyString(operation.id)
		or not validDependencies(operation)
	then
		return fail("Operation shape or dependencies are invalid")
	end
	if operation.rationale ~= nil and typeof(operation.rationale) ~= "string" then
		return fail(`Operation {operation.id} rationale is invalid`)
	end
	if operation.kind == "createInstance" then
		if
			not hasOnlyFields(operation, {
				id = true,
				kind = true,
				rationale = true,
				dependsOn = true,
				target = true,
				preconditions = true,
			})
			or typeof(operation.target) ~= "table"
			or not hasOnlyFields(operation.target, { parent = true, className = true, name = true })
			or not validLocator(operation.target.parent)
			or not nonEmptyString(operation.target.className)
			or not nonEmptyString(operation.target.name)
			or not Policy.AllowedClasses[operation.target.className]
			or typeof(operation.preconditions) ~= "table"
			or not hasOnlyFields(operation.preconditions, { parentClass = true, nameCollision = true })
			or operation.preconditions.nameCollision ~= "fail"
			or (
				operation.preconditions.parentClass ~= nil
				and not nonEmptyString(operation.preconditions.parentClass)
			)
		then
			return fail(`Create operation {operation.id} is invalid or unsupported`)
		end
	elseif operation.kind == "createScript" then
		if
			not hasOnlyFields(operation, {
				id = true,
				kind = true,
				rationale = true,
				dependsOn = true,
				target = true,
				preconditions = true,
				after = true,
			})
			or typeof(operation.target) ~= "table"
			or not hasOnlyFields(operation.target, { parent = true, className = true, name = true })
			or not validLocator(operation.target.parent)
			or not nonEmptyString(operation.target.className)
			or not nonEmptyString(operation.target.name)
			or not Policy.AllowedScriptClasses[operation.target.className]
			or typeof(operation.preconditions) ~= "table"
			or not hasOnlyFields(operation.preconditions, { parentClass = true, nameCollision = true })
			or operation.preconditions.nameCollision ~= "fail"
			or (operation.preconditions.parentClass ~= nil and not nonEmptyString(
				operation.preconditions.parentClass
			))
			or typeof(operation.after) ~= "table"
			or not hasOnlyFields(operation.after, { source = true })
			or typeof(operation.after.source) ~= "string"
			or #operation.after.source > 5000000
		then
			return fail(`Create script operation {operation.id} is invalid or unsupported`)
		end
	elseif operation.kind == "setProperty" then
		if
			not hasOnlyFields(operation, {
				id = true,
				kind = true,
				rationale = true,
				dependsOn = true,
				target = true,
				property = true,
				before = true,
				after = true,
			})
			or not validLocator(operation.target)
			or not nonEmptyString(operation.property)
			or not validTaggedValue(operation.before)
			or not validTaggedValue(operation.after)
		then
			return fail(`Property operation {operation.id} is malformed`)
		end
		local allowed, policyError =
			Policy.validateProperty(operation.property, operation.before, operation.after)
		if not allowed then
			return fail(policyError or "Property policy failed")
		end
	elseif operation.kind == "replaceScriptSource" then
		if
			not hasOnlyFields(operation, {
				id = true,
				kind = true,
				rationale = true,
				dependsOn = true,
				target = true,
				before = true,
				after = true,
			})
			or not validLocator(operation.target)
			or typeof(operation.before) ~= "table"
			or not hasOnlyFields(operation.before, { sourceSha256 = true, source = true })
			or typeof(operation.before.sourceSha256) ~= "string"
			or not string.match(operation.before.sourceSha256, "^[a-f0-9]+$")
			or #operation.before.sourceSha256 ~= 64
			or (operation.before.source ~= nil and typeof(operation.before.source) ~= "string")
			or (operation.before.source ~= nil and #operation.before.source > 5000000)
			or typeof(operation.after) ~= "table"
			or not hasOnlyFields(operation.after, { source = true })
			or typeof(operation.after.source) ~= "string"
			or #operation.after.source > 5000000
		then
			return fail(`Script operation {operation.id} is malformed`)
		end
		if
			operation.before.source ~= nil
			and Sha256(operation.before.source) ~= operation.before.sourceSha256
		then
			return fail(`Script operation {operation.id} before source does not match its digest`)
		end
	elseif operation.kind == "deleteInstance" then
		if
			not hasOnlyFields(operation, {
				id = true,
				kind = true,
				rationale = true,
				dependsOn = true,
				target = true,
				preconditions = true,
			})
			or not validLocator(operation.target)
			or #operation.target.path <= 1
			or typeof(operation.preconditions) ~= "table"
			or not hasOnlyFields(operation.preconditions, { className = true, maxChildren = true })
			or (operation.preconditions.className ~= nil and not nonEmptyString(
				operation.preconditions.className
			))
			or (
				operation.preconditions.maxChildren ~= nil
				and (
					typeof(operation.preconditions.maxChildren) ~= "number"
					or operation.preconditions.maxChildren < 0
					or operation.preconditions.maxChildren % 1 ~= 0
				)
			)
		then
			return fail(`Delete operation {operation.id} is invalid or unsupported`)
		end
	elseif operation.kind == "reparentInstance" then
		if
			not hasOnlyFields(operation, {
				id = true,
				kind = true,
				rationale = true,
				dependsOn = true,
				target = true,
				after = true,
				preconditions = true,
			})
			or not validLocator(operation.target)
			or #operation.target.path <= 1
			or typeof(operation.after) ~= "table"
			or not hasOnlyFields(operation.after, { parent = true, name = true })
			or (operation.after.parent == nil and operation.after.name == nil)
			or (operation.after.parent ~= nil and not validLocator(operation.after.parent))
			or (operation.after.name ~= nil and not nonEmptyString(operation.after.name))
			or typeof(operation.preconditions) ~= "table"
			or not hasOnlyFields(operation.preconditions, { className = true, nameCollision = true })
			or operation.preconditions.nameCollision ~= "fail"
			or (
				operation.preconditions.className ~= nil
				and not nonEmptyString(operation.preconditions.className)
			)
		then
			return fail(`Reparent operation {operation.id} is invalid or unsupported`)
		end
	else
		return fail(`Operation {operation.id} uses an unsupported kind`)
	end
	return true, "Operation validated"
end

function ProtocolValidator.validateRecord(record: any): (boolean, string)
	if typeof(record) ~= "table" or typeof(record.proposal) ~= "table" then
		return fail("Proposal record is malformed")
	end
	if
		typeof(record.digest) ~= "string"
		or Sha256(CanonicalJson.encode(record.proposal)) ~= record.digest
	then
		return fail("Proposal payload does not match its companion digest")
	end
	local proposal = record.proposal
	if
		not hasOnlyFields(proposal, {
			protocolVersion = true,
			proposalId = true,
			revision = true,
			previousRevision = true,
			title = true,
			summary = true,
			createdAt = true,
			producer = true,
			plan = true,
			operations = true,
		})
		or (proposal.protocolVersion ~= "0.1" and proposal.protocolVersion ~= "0.2")
		or not nonEmptyString(proposal.proposalId)
		or typeof(proposal.revision) ~= "number"
		or proposal.revision < 1
		or proposal.revision % 1 ~= 0
		or not nonEmptyString(proposal.title)
		or not nonEmptyString(proposal.summary)
		or not nonEmptyString(proposal.createdAt)
		or typeof(proposal.operations) ~= "table"
		or #proposal.operations == 0
		or #proposal.operations > 1000
	then
		return fail("Proposal envelope or operation list is invalid")
	end
	if
		(proposal.revision == 1 and proposal.previousRevision ~= nil)
		or (
			proposal.revision > 1
			and (
				typeof(proposal.previousRevision) ~= "number"
				or proposal.previousRevision < 1
				or proposal.previousRevision >= proposal.revision
			)
		)
	then
		return fail("Proposal revision lineage is invalid")
	end
	if
		typeof(proposal.producer) ~= "table"
		or not hasOnlyFields(proposal.producer, { name = true, version = true })
		or not nonEmptyString(proposal.producer.name)
		or not nonEmptyString(proposal.producer.version)
		or typeof(proposal.plan) ~= "table"
		or not hasOnlyFields(proposal.plan, { format = true, content = true })
		or (proposal.plan.format ~= "markdown" and proposal.plan.format ~= "plain")
		or not nonEmptyString(proposal.plan.content)
	then
		return fail("Proposal producer or plan is invalid")
	end
	local ids = {}
	for _, operation in proposal.operations do
		local valid, operationError = validateOperation(operation)
		if not valid then
			return false, operationError
		end
		if ids[operation.id] then
			return fail("Operation IDs must be non-empty and unique")
		end
		ids[operation.id] = true
	end
	local ordered, orderError = OperationOrder.sort(proposal.operations)
	if not ordered then
		return fail(orderError or "Operation dependencies are invalid")
	end
	if record.status ~= "APPROVED" or typeof(record.decision) ~= "table" then
		return fail("Only a browser- or Studio-approved revision may enter preflight")
	end
	if record.decision.kind ~= "APPROVE" or record.decision.proposalDigest ~= record.digest then
		return fail("Approval is not bound to this exact proposal digest")
	end
	return true, "Proposal protocol, approval, and digest verified"
end

return ProtocolValidator
