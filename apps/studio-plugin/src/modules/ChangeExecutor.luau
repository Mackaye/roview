--!strict

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local PreflightValidator = require(script.Parent.PreflightValidator)
local OperationOrder = require(script.Parent.OperationOrder)
local Policy = require(script.Parent.Policy)
local Sha256 = require(script.Parent.Sha256)
local ValueCodec = require(script.Parent.ValueCodec)

local ChangeExecutor = {}

local function finishRecording(
	recording: string,
	operation: Enum.FinishRecordingOperation
): (boolean, string?)
	local success, finishError = pcall(function()
		ChangeHistoryService:FinishRecording(recording, operation)
	end)
	return success, if success then nil else tostring(finishError)
end

export type ApplyOptions = {
	failAtOperation: number?,
}

function ChangeExecutor.apply(proposal: any, options: ApplyOptions?): (boolean, string)
	local preflight = PreflightValidator.validate(proposal)
	if not preflight.ok then
		return false, table.concat(preflight.errors, "\n")
	end

	local recording = ChangeHistoryService:TryBeginRecording(
		`Roview_{proposal.proposalId}_{proposal.revision}`,
		`Roview: {proposal.title}`
	)
	if not recording then
		return false, "Studio could not start a change-history recording."
	end

	local ordered, orderError = OperationOrder.sort(proposal.operations)
	if not ordered then
		finishRecording(recording, Enum.FinishRecordingOperation.Cancel)
		return false, orderError or "Operation ordering failed"
	end

	local rollback = {}
	local success, applyError = pcall(function()
		for index, operation in ordered do
			if options and options.failAtOperation == index then
				error(`Injected safety-spike failure at operation {index}`)
			end
			local target = preflight.targets[operation.id]
			if operation.kind == "createInstance" then
				if not Policy.AllowedClasses[operation.target.className] then
					error(`Class {operation.target.className} is not allowed`)
				end
				local created = Instance.new(operation.target.className)
				created.Name = operation.target.name
				created.Parent = target
				table.insert(rollback, function()
					if created.Parent ~= target or created.Name ~= operation.target.name then
						error("Created instance changed during apply; refusing unsafe rollback")
					end
					created:Destroy()
				end)
			elseif operation.kind == "createScript" then
				if not Policy.AllowedScriptClasses[operation.target.className] then
					error(`Class {operation.target.className} is not allowed for createScript`)
				end
				local created = Instance.new(operation.target.className) :: any
				created.Name = operation.target.name
				created.Source = operation.after.source
				created.Parent = target
				table.insert(rollback, function()
					if created.Parent ~= target or created.Name ~= operation.target.name then
						error("Created script changed during apply; refusing unsafe rollback")
					end
					created:Destroy()
				end)
			elseif operation.kind == "setProperty" then
				local writableTarget = target :: any
				local previous = writableTarget[operation.property]
				writableTarget[operation.property] = ValueCodec.decode(operation.after)
				if not ValueCodec.equals(writableTarget[operation.property], operation.after) then
					error(`Property {operation.property} did not reach its reviewed after value`)
				end
				table.insert(rollback, function()
					if not ValueCodec.equals(writableTarget[operation.property], operation.after) then
						error(`Property {operation.property} changed during apply; refusing unsafe rollback`)
					end
					writableTarget[operation.property] = previous
				end)
			elseif operation.kind == "replaceScriptSource" then
				local scriptTarget = target :: any
				local currentSource = scriptTarget.Source or ""
				if Sha256(currentSource) ~= operation.before.sourceSha256 then
					error("Script source changed during apply; hash precondition failed")
				end
				scriptTarget.Source = operation.after.source
				local afterHash = Sha256(operation.after.source)
				if Sha256(scriptTarget.Source) ~= afterHash then
					error("Script did not reach its reviewed after source")
				end

				-- If the script is currently open in Studio editor, sync the open document tab
				pcall(function()
					local doc = ScriptEditorService:FindScriptDocument(scriptTarget)
					if doc then
						ScriptEditorService:UpdateSourceAsync(scriptTarget, function()
							return operation.after.source
						end)
					end
				end)

				table.insert(rollback, function()
					if Sha256(scriptTarget.Source) ~= afterHash then
						error("Script changed during apply; refusing unsafe rollback")
					end
					scriptTarget.Source = currentSource
					pcall(function()
						local doc = ScriptEditorService:FindScriptDocument(scriptTarget)
						if doc then
							ScriptEditorService:UpdateSourceAsync(scriptTarget, function()
								return currentSource
							end)
						end
					end)
				end)
			elseif operation.kind == "deleteInstance" then
				local previousParent = target.Parent
				target.Parent = nil
				table.insert(rollback, function()
					target.Parent = previousParent
				end)
			elseif operation.kind == "reparentInstance" then
				local previousParent = target.Parent
				local previousName = target.Name
				if operation.after.name ~= nil then
					target.Name = operation.after.name
				end
				if preflight.secondaryTargets and preflight.secondaryTargets[operation.id] then
					target.Parent = preflight.secondaryTargets[operation.id]
				end
				table.insert(rollback, function()
					target.Name = previousName
					target.Parent = previousParent
				end)
			end
		end
	end)

	if not success then
		local rollbackErrors = {}
		for index = #rollback, 1, -1 do
			local restored, restoreError = pcall(rollback[index])
			if not restored then
				table.insert(rollbackErrors, tostring(restoreError))
			end
		end
		if recording then
			local cancelled, cancelError = finishRecording(recording, Enum.FinishRecordingOperation.Cancel)
			if not cancelled then
				table.insert(rollbackErrors, `Change-history cancellation failed: {cancelError}`)
			end
		end
		if #rollbackErrors > 0 then
			return false,
				`Apply stopped: {tostring(applyError)}. Rollback also failed: {table.concat(
					rollbackErrors,
					"; "
				)}. Inspect the place and use Undo.`
		end
		return false, `Apply stopped: {tostring(applyError)}. Inspect the place before continuing.`
	end

	local committed, commitError = finishRecording(recording, Enum.FinishRecordingOperation.Commit)
	if not committed then
		return false,
			`Operations reached their reviewed after-values, but Studio could not commit the history recording: {commitError}. Inspect the place; apply will not retry.`
	end
	return true, `Applied {#ordered} operations as one Studio undo action.`
end

return ChangeExecutor
