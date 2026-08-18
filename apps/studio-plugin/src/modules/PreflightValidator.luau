--!strict

local ScriptEditorService = game:GetService("ScriptEditorService")
local RunService = game:GetService("RunService")

local LocatorResolver = require(script.Parent.LocatorResolver)
local Policy = require(script.Parent.Policy)
local Sha256 = require(script.Parent.Sha256)
local ValueCodec = require(script.Parent.ValueCodec)

export type PreflightIssue = {
	operationId: string,
	code: string,
	message: string,
	expected: any?,
	actual: any?,
	currentSourceSha256: string?,
}

export type PreflightResult = {
	ok: boolean,
	errors: { string },
	issues: { PreflightIssue },
	targets: { [string]: Instance },
	secondaryTargets: { [string]: Instance }?,
}

local PreflightValidator = {}

function PreflightValidator.validate(proposal: any): PreflightResult
	local errors = {}
	local issues: { PreflightIssue } = {}
	local targets = {}
	local secondaryTargets: { [string]: Instance } = {}
	local plannedCreates: { [Instance]: { [string]: boolean } } = {}
	local plannedWrites: { [Instance]: { [string]: boolean } } = {}
	local plannedDeletes: { [Instance]: boolean } = {}

	local function addIssue(
		opId: string,
		code: string,
		msg: string,
		expected: any?,
		actual: any?,
		currentSha: string?
	)
		table.insert(errors, `{opId}: {msg}`)
		table.insert(issues, {
			operationId = opId,
			code = code,
			message = msg,
			expected = expected,
			actual = actual,
			currentSourceSha256 = currentSha,
		})
	end

	if RunService:IsRunning() then
		table.insert(errors, "Apply is disabled while Studio is running or playing.")
		table.insert(issues, {
			operationId = "global",
			code = "GENERIC",
			message = "Apply is disabled while Studio is running or playing.",
		})
	end

	for _, operation in proposal.operations do
		if operation.kind == "createInstance" then
			local parent, resolveError = LocatorResolver.resolve(operation.target.parent)
			if not parent then
				addIssue(
					operation.id,
					"LOCATOR_MISSING",
					resolveError or "Parent locator could not be resolved"
				)
			elseif parent:FindFirstChild(operation.target.name) then
				addIssue(
					operation.id,
					"NAME_COLLISION",
					`{operation.target.name} already exists under parent`
				)
			elseif plannedCreates[parent] and plannedCreates[parent][operation.target.name] then
				addIssue(
					operation.id,
					"NAME_COLLISION",
					`another operation creates {operation.target.name} under this parent`
				)
			elseif not Policy.AllowedClasses[operation.target.className] then
				addIssue(operation.id, "CLASS_MISMATCH", `class {operation.target.className} is not allowed`)
			elseif
				operation.preconditions.parentClass
				and parent.ClassName ~= operation.preconditions.parentClass
			then
				addIssue(
					operation.id,
					"CLASS_MISMATCH",
					`expected parent class {operation.preconditions.parentClass}; found {parent.ClassName}`,
					operation.preconditions.parentClass,
					parent.ClassName
				)
			else
				plannedCreates[parent] = plannedCreates[parent] or {}
				plannedCreates[parent][operation.target.name] = true
				targets[operation.id] = parent
			end
		elseif operation.kind == "createScript" then
			local parent, resolveError = LocatorResolver.resolve(operation.target.parent)
			if not parent then
				addIssue(
					operation.id,
					"LOCATOR_MISSING",
					resolveError or "Parent locator could not be resolved"
				)
			elseif parent:FindFirstChild(operation.target.name) then
				addIssue(
					operation.id,
					"NAME_COLLISION",
					`{operation.target.name} already exists under parent`
				)
			elseif plannedCreates[parent] and plannedCreates[parent][operation.target.name] then
				addIssue(
					operation.id,
					"NAME_COLLISION",
					`another operation creates {operation.target.name} under this parent`
				)
			elseif not Policy.AllowedScriptClasses[operation.target.className] then
				addIssue(
					operation.id,
					"CLASS_MISMATCH",
					`class {operation.target.className} is not allowed for createScript`
				)
			elseif
				operation.preconditions.parentClass
				and parent.ClassName ~= operation.preconditions.parentClass
			then
				addIssue(
					operation.id,
					"CLASS_MISMATCH",
					`expected parent class {operation.preconditions.parentClass}; found {parent.ClassName}`,
					operation.preconditions.parentClass,
					parent.ClassName
				)
			else
				plannedCreates[parent] = plannedCreates[parent] or {}
				plannedCreates[parent][operation.target.name] = true
				targets[operation.id] = parent
			end
		elseif operation.kind == "setProperty" then
			local propertyAllowed, policyError =
				Policy.validateProperty(operation.property, operation.before, operation.after)
			local target, resolveError = LocatorResolver.resolve(operation.target)
			if not propertyAllowed then
				addIssue(operation.id, "GENERIC", policyError or "Property not allowed")
			elseif not target then
				addIssue(
					operation.id,
					"LOCATOR_MISSING",
					resolveError or "Target locator could not be resolved"
				)
			else
				local readSuccess, current = pcall(function()
					return (target :: any)[operation.property]
				end)
				if not readSuccess then
					addIssue(
						operation.id,
						"GENERIC",
						`property {operation.property} is unavailable on target`
					)
				elseif plannedWrites[target] and plannedWrites[target][operation.property] then
					addIssue(
						operation.id,
						"GENERIC",
						`another operation writes {operation.property} on this target`
					)
				elseif not ValueCodec.equals(current, operation.before) then
					addIssue(
						operation.id,
						"PROPERTY_DRIFT",
						`property value changed in Studio since review`,
						operation.before,
						current
					)
				else
					plannedWrites[target] = plannedWrites[target] or {}
					plannedWrites[target][operation.property] = true
					targets[operation.id] = target
				end
			end
		elseif operation.kind == "replaceScriptSource" then
			local target, resolveError = LocatorResolver.resolve(operation.target)
			if not target then
				addIssue(
					operation.id,
					"LOCATOR_MISSING",
					resolveError or "Script locator could not be resolved"
				)
			elseif not target:IsA("LuaSourceContainer") then
				addIssue(operation.id, "CLASS_MISMATCH", "target is not a script container")
			else
				local sourceSuccess, source = pcall(function()
					return ScriptEditorService:GetEditorSource(target)
				end)
				if not sourceSuccess then
					addIssue(operation.id, "GENERIC", "current editor source is unavailable in Studio")
				elseif plannedWrites[target] and plannedWrites[target].Source then
					addIssue(operation.id, "GENERIC", "another operation writes this script source")
				else
					local currentSha = Sha256(source)
					if currentSha ~= operation.before.sourceSha256 then
						addIssue(
							operation.id,
							"SOURCE_DRIFT",
							`script source changed in Studio since review`,
							operation.before.sourceSha256,
							currentSha,
							currentSha
						)
					else
						plannedWrites[target] = plannedWrites[target] or {}
						plannedWrites[target].Source = true
						targets[operation.id] = target
					end
				end
			end
		elseif operation.kind == "deleteInstance" then
			local target, resolveError = LocatorResolver.resolve(operation.target)
			if not target then
				addIssue(
					operation.id,
					"LOCATOR_MISSING",
					resolveError or "Target locator could not be resolved"
				)
			elseif #operation.target.path <= 1 or target.Parent == game then
				addIssue(operation.id, "SERVICE_PROTECTION", "cannot delete a top-level service")
			elseif plannedDeletes[target] then
				addIssue(operation.id, "GENERIC", "instance is already targeted for deletion")
			elseif
				operation.preconditions.className
				and target.ClassName ~= operation.preconditions.className
			then
				addIssue(
					operation.id,
					"CLASS_MISMATCH",
					`expected class {operation.preconditions.className}; found {target.ClassName}`,
					operation.preconditions.className,
					target.ClassName
				)
			elseif
				operation.preconditions.maxChildren ~= nil
				and #target:GetChildren() > operation.preconditions.maxChildren
			then
				addIssue(
					operation.id,
					"CHILD_LIMIT_EXCEEDED",
					`target has {#target:GetChildren()} children (max allowed is {operation.preconditions.maxChildren})`,
					operation.preconditions.maxChildren,
					#target:GetChildren()
				)
			else
				plannedDeletes[target] = true
				targets[operation.id] = target
			end
		elseif operation.kind == "reparentInstance" then
			local target, resolveError = LocatorResolver.resolve(operation.target)
			if not target then
				addIssue(
					operation.id,
					"LOCATOR_MISSING",
					resolveError or "Target locator could not be resolved"
				)
			elseif #operation.target.path <= 1 or target.Parent == game then
				addIssue(operation.id, "SERVICE_PROTECTION", "cannot reparent a top-level service")
			elseif
				operation.preconditions.className
				and target.ClassName ~= operation.preconditions.className
			then
				addIssue(
					operation.id,
					"CLASS_MISMATCH",
					`expected class {operation.preconditions.className}; found {target.ClassName}`,
					operation.preconditions.className,
					target.ClassName
				)
			else
				local destinationParent = target.Parent
				local hasDestinationError = false
				if operation.after.parent ~= nil then
					local newParent, parentError = LocatorResolver.resolve(operation.after.parent)
					if not newParent then
						addIssue(operation.id, "LOCATOR_MISSING", `destination parent error: {parentError}`)
						hasDestinationError = true
					elseif newParent == target or newParent:IsDescendantOf(target) then
						addIssue(
							operation.id,
							"GENERIC",
							"cannot reparent an instance into itself or its descendants"
						)
						hasDestinationError = true
					else
						destinationParent = newParent
						secondaryTargets[operation.id] = newParent
					end
				end

				local newName = operation.after.name or target.Name
				if destinationParent and not hasDestinationError then
					local existingChild = destinationParent:FindFirstChild(newName)
					if existingChild and existingChild ~= target then
						addIssue(
							operation.id,
							"NAME_COLLISION",
							`destination already contains an instance named '{newName}'`
						)
						hasDestinationError = true
					end
				end

				if not hasDestinationError then
					targets[operation.id] = target
				end
			end
		else
			addIssue(operation.id, "GENERIC", `unsupported operation {operation.kind}`)
		end
	end

	return {
		ok = #errors == 0,
		errors = errors,
		issues = issues,
		targets = targets,
		secondaryTargets = secondaryTargets,
	}
end

return PreflightValidator
