--!strict

export type DiffLine = {
	line: number,
	text: string,
	kind: string, -- "context", "added", "removed"
}

export type AlignedPair = {
	before: DiffLine?,
	after: DiffLine?,
}

local ReviewModel = {}

local RISK_RANK = { low = 1, medium = 2, high = 3 }

local LUAU_KEYWORDS: { [string]: boolean } = {
	["and"] = true,
	["break"] = true,
	["do"] = true,
	["else"] = true,
	["elseif"] = true,
	["end"] = true,
	["false"] = true,
	["for"] = true,
	["function"] = true,
	["if"] = true,
	["in"] = true,
	["local"] = true,
	["nil"] = true,
	["not"] = true,
	["or"] = true,
	["repeat"] = true,
	["return"] = true,
	["then"] = true,
	["true"] = true,
	["until"] = true,
	["while"] = true,
	["continue"] = true,
	["export"] = true,
	["type"] = true,
}

local LUAU_BUILTINS: { [string]: boolean } = {
	["Instance"] = true,
	["Vector3"] = true,
	["Vector2"] = true,
	["CFrame"] = true,
	["Color3"] = true,
	["UDim2"] = true,
	["UDim"] = true,
	["math"] = true,
	["table"] = true,
	["string"] = true,
	["task"] = true,
	["Enum"] = true,
	["workspace"] = true,
	["game"] = true,
	["script"] = true,
	["print"] = true,
	["warn"] = true,
	["error"] = true,
	["pcall"] = true,
	["xpcall"] = true,
	["require"] = true,
	["typeof"] = true,
	["setmetatable"] = true,
	["getmetatable"] = true,
	["ColorSequence"] = true,
	["NumberSequence"] = true,
	["NumberRange"] = true,
	["Rect"] = true,
	["Ray"] = true,
}

export type ReviewItem = {
	key: string,
	kind: string, -- "plan", "replaceScriptSource", "setProperty", "createInstance"
	group: string,
	label: string,
	icon: string,
	operation: any?,
}

local function escapeXml(text: string): string
	local escaped = string.gsub(text, "&", "&amp;")
	escaped = string.gsub(escaped, "<", "&lt;")
	escaped = string.gsub(escaped, ">", "&gt;")
	escaped = string.gsub(escaped, '"', "&quot;")
	escaped = string.gsub(escaped, "'", "&apos;")
	return escaped
end

function ReviewModel.highlightMarkdown(text: string): string
	if text == "" then
		return ""
	end
	-- Header: # Title or ## Subtitle
	if string.match(text, "^#+%s") then
		return `<font color="#79B8FF"><b>{escapeXml(text)}</b></font>`
	end
	-- Bullet point: - item or * item
	if string.match(text, "^%s*[%-%*]%s") then
		local _, body = string.match(text, "^(%s*[%-%*]%s)(.*)$")
		return `<font color="#FF7B72"><b>•</b></font> {escapeXml(body or "")}`
	end
	-- Quote / Callout: > ...
	if string.match(text, "^>%s") then
		return `<font color="#E3B341"><i>{escapeXml(text)}</i></font>`
	end
	return escapeXml(text)
end

function ReviewModel.highlightLuau(text: string): string
	if text == "" then
		return ""
	end

	local commentPos = string.find(text, "%-%-")
	local codePart = text
	local commentPart = ""

	if commentPos then
		codePart = string.sub(text, 1, commentPos - 1)
		commentPart = string.sub(text, commentPos)
	end

	local output = {}
	local i = 1
	local len = #codePart

	while i <= len do
		local char = string.sub(codePart, i, i)

		-- String literal: "..." or '...'
		if char == '"' or char == "'" then
			local quote = char
			local j = i + 1
			while j <= len do
				local nextChar = string.sub(codePart, j, j)
				if nextChar == "\\" then
					j += 2
				elseif nextChar == quote then
					j += 1
					break
				else
					j += 1
				end
			end
			local strToken = string.sub(codePart, i, j - 1)
			table.insert(output, `<font color="#A5D6FF">{escapeXml(strToken)}</font>`)
			i = j
		-- Identifiers & Keywords
		elseif string.match(char, "[%a_]") then
			local ident = string.match(codePart, "^[%w_]+", i)
			if ident then
				if LUAU_KEYWORDS[ident] then
					table.insert(output, `<font color="#FF7B72"><b>{escapeXml(ident)}</b></font>`)
				elseif LUAU_BUILTINS[ident] then
					table.insert(output, `<font color="#79B8FF">{escapeXml(ident)}</font>`)
				else
					table.insert(output, escapeXml(ident))
				end
				i += #ident
			else
				table.insert(output, escapeXml(char))
				i += 1
			end
		-- Numbers
		elseif string.match(char, "%d") then
			local num = string.match(codePart, "^%d+%.?%d*", i)
			if num then
				table.insert(output, `<font color="#79C0FF">{escapeXml(num)}</font>`)
				i += #num
			else
				table.insert(output, escapeXml(char))
				i += 1
			end
		-- Symbols / operators / spaces
		else
			table.insert(output, escapeXml(char))
			i += 1
		end
	end

	if commentPart ~= "" then
		table.insert(output, `<font color="#8B949E"><i>{escapeXml(commentPart)}</i></font>`)
	end

	return table.concat(output)
end

function ReviewModel.operationPath(operation: any): string
	local path = operation.target.path
	if operation.kind == "createInstance" then
		local p = table.clone(operation.target.parent.path)
		table.insert(p, operation.target.name)
		path = p
	end
	return table.concat(path or {}, "/")
end

function ReviewModel.operationGroup(operation: any): string
	local path = operation.target.path
	if operation.kind == "createInstance" then
		local p = table.clone(operation.target.parent.path)
		table.insert(p, operation.target.name)
		path = p
	end
	local service = path[1] or "DataModel"
	return if path[2] then service .. "/" .. path[2] else service
end

function ReviewModel.operationIcon(operation: any): string
	if operation.kind == "replaceScriptSource" then
		return "📜"
	elseif operation.kind == "setProperty" then
		return "🧩"
	elseif operation.kind == "createInstance" then
		return "📦"
	end
	return "📄"
end

function ReviewModel.statsForItem(item: ReviewItem, record: any): { added: number, removed: number }
	if item.kind == "plan" then
		local content = if record
				and record.proposal
				and record.proposal.plan
			then record.proposal.plan.content
			else ""
		return { added = #ReviewModel.splitLines(content), removed = 0 }
	end
	if not item.operation then
		return { added = 0, removed = 0 }
	end
	local sources = ReviewModel.operationSources(item.operation)
	local tokens = ReviewModel.rawDiff(sources.before, sources.after)
	local added = 0
	local removed = 0
	for _, token in tokens do
		if token.kind == "added" then
			added += 1
		elseif token.kind == "removed" then
			removed += 1
		end
	end
	return { added = added, removed = removed }
end

function ReviewModel.createItems(record: any): { ReviewItem }
	local items: { ReviewItem } = {}
	-- 1. Proposal Plan item
	table.insert(items, {
		key = "plan",
		kind = "plan",
		group = "Proposal",
		label = "plan.md",
		icon = "📋",
		operation = nil,
	})

	if not record or not record.proposal or not record.proposal.operations then
		return items
	end

	for _, operation in record.proposal.operations do
		local fullPath = ReviewModel.operationPath(operation)
		local parts = string.split(fullPath, "/")
		local labelText = parts[#parts] or fullPath
		if operation.kind == "setProperty" then
			labelText = `{labelText}.{operation.property}`
		end
		table.insert(items, {
			key = operation.id,
			kind = operation.kind,
			group = ReviewModel.operationGroup(operation),
			label = labelText,
			icon = ReviewModel.operationIcon(operation),
			operation = operation,
		})
	end
	return items
end

local function internalOperationPath(operation: any): { string }
	if operation.kind == "createInstance" then
		local path = table.clone(operation.target.parent.path)
		table.insert(path, operation.target.name)
		return path
	end
	return operation.target.path
end

function ReviewModel.operationIndicator(operation: any): string
	if operation.kind == "createInstance" then
		return "CREATE"
	elseif operation.kind == "setProperty" then
		return "CHANGE"
	elseif operation.kind == "replaceScriptSource" then
		return "CODE"
	end
	return "UNKNOWN"
end

function ReviewModel.valueText(value: any): string
	if not value then
		return "nil"
	end
	if value.type == "string" then
		return string.format("%q", value.value)
	elseif value.type == "number" or value.type == "boolean" then
		return tostring(value.value)
	elseif value.type == "Color3" then
		return `Color3({value.r}, {value.g}, {value.b})`
	elseif value.type == "Vector3" then
		return `Vector3({value.x}, {value.y}, {value.z})`
	elseif value.type == "Enum" then
		return `Enum.{value.enum}.{value.item}`
	end
	return "<unsupported value>"
end

function ReviewModel.splitLines(str: string): { string }
	local lines = {}
	local clean = string.gsub(str or "", "\r\n", "\n")
	for line in string.gmatch(clean .. "\n", "(.-)\n") do
		table.insert(lines, line)
	end
	if #lines > 0 and lines[#lines] == "" then
		table.remove(lines, #lines)
	end
	return lines
end

function ReviewModel.operationSources(operation: any): { before: { string }, after: { string } }
	if operation.kind == "replaceScriptSource" then
		local beforeSrc = if operation.before and operation.before.source
			then operation.before.source
			else "-- Source body was not supplied; hash-only precondition"
		local afterSrc = if operation.after and operation.after.source then operation.after.source else ""
		return {
			before = ReviewModel.splitLines(beforeSrc),
			after = ReviewModel.splitLines(afterSrc),
		}
	elseif operation.kind == "setProperty" then
		return {
			before = { `{operation.property} = {ReviewModel.valueText(operation.before)}` },
			after = { `{operation.property} = {ReviewModel.valueText(operation.after)}` },
		}
	elseif operation.kind == "createInstance" then
		local parentPath = if operation.target.parent and operation.target.parent.path
			then table.concat(operation.target.parent.path, "/")
			else "Workspace"
		return {
			before = {},
			after = {
				`ClassName = {operation.target.className or "Instance"}`,
				`Name = {string.format("%q", operation.target.name or "NewInstance")}`,
				`Parent = {parentPath}`,
			},
		}
	end
	return { before = {}, after = {} }
end

function ReviewModel.rawDiff(
	beforeLines: { string },
	afterLines: { string }
): { { kind: string, text: string } }
	local n = #beforeLines
	local m = #afterLines

	if n * m > 250000 then
		local result = {}
		local maxLen = math.max(n, m)
		for index = 1, maxLen do
			local b = beforeLines[index]
			local a = afterLines[index]
			if b == a and b ~= nil then
				table.insert(result, { kind = "context", text = b })
			else
				if b ~= nil then
					table.insert(result, { kind = "removed", text = b })
				end
				if a ~= nil then
					table.insert(result, { kind = "added", text = a })
				end
			end
		end
		return result
	end

	local dp = {}
	for i = 0, n + 1 do
		dp[i] = table.create(m + 2, 0)
	end
	for i = n, 1, -1 do
		for j = m, 1, -1 do
			if beforeLines[i] == afterLines[j] then
				dp[i][j] = dp[i + 1][j + 1] + 1
			else
				dp[i][j] = math.max(dp[i + 1][j], dp[i][j + 1])
			end
		end
	end

	local result = {}
	local i, j = 1, 1
	while i <= n or j <= m do
		if i <= n and j <= m and beforeLines[i] == afterLines[j] then
			table.insert(result, { kind = "context", text = beforeLines[i] })
			i += 1
			j += 1
		elseif j > m or (i <= n and dp[i + 1][j] >= dp[i][j + 1]) then
			table.insert(result, { kind = "removed", text = beforeLines[i] })
			i += 1
		else
			table.insert(result, { kind = "added", text = afterLines[j] })
			j += 1
		end
	end
	return result
end

function ReviewModel.alignedDiff(beforeLines: { string }, afterLines: { string }): { AlignedPair }
	local raw = ReviewModel.rawDiff(beforeLines, afterLines)
	local pairs: { AlignedPair } = {}
	local oldLine = 1
	local newLine = 1
	local index = 1

	while index <= #raw do
		local token = raw[index]
		if token.kind == "context" then
			table.insert(pairs, {
				before = { line = oldLine, text = token.text, kind = "context" },
				after = { line = newLine, text = token.text, kind = "context" },
			})
			oldLine += 1
			newLine += 1
			index += 1
		else
			local removed: { DiffLine } = {}
			local added: { DiffLine } = {}
			while index <= #raw and raw[index].kind ~= "context" do
				local current = raw[index]
				if current.kind == "removed" then
					table.insert(removed, { line = oldLine, text = current.text, kind = "removed" })
					oldLine += 1
				else
					table.insert(added, { line = newLine, text = current.text, kind = "added" })
					newLine += 1
				end
				index += 1
			end
			local changedLength = math.max(#removed, #added)
			for changedIndex = 1, changedLength do
				table.insert(pairs, {
					before = removed[changedIndex] or nil,
					after = added[changedIndex] or nil,
				})
			end
		end
	end
	return pairs
end

function ReviewModel.diffLines(
	beforeStr: string?,
	afterStr: string
): { { kind: string, text: string, oldLine: number?, newLine: number? } }
	local afterLines = ReviewModel.splitLines(afterStr or "")
	if not beforeStr or beforeStr == "" then
		local result = {}
		for index, text in afterLines do
			table.insert(result, { kind = "added", text = text, newLine = index })
		end
		return result
	end
	local beforeLines = ReviewModel.splitLines(beforeStr)
	local raw = ReviewModel.rawDiff(beforeLines, afterLines)

	local result = {}
	local oldNo = 1
	local newNo = 1
	for _, token in raw do
		if token.kind == "context" then
			table.insert(result, { kind = "context", text = token.text, oldLine = oldNo, newLine = newNo })
			oldNo += 1
			newNo += 1
		elseif token.kind == "removed" then
			table.insert(result, { kind = "removed", text = token.text, oldLine = oldNo })
			oldNo += 1
		else
			table.insert(result, { kind = "added", text = token.text, newLine = newNo })
			newNo += 1
		end
	end
	return result
end

function ReviewModel.summarize(proposal: any): any
	local risk = "low"
	local reasons = {}
	local services = {}
	local groups = {}
	for _, operation in proposal.operations do
		local path = internalOperationPath(operation)
		local service = path[1] or "DataModel"
		services[service] = true
		local subtree = if path[2] then service .. "/" .. path[2] else service
		groups[subtree] = groups[subtree] or {}
		table.insert(groups[subtree], operation)

		local operationRisk = "low"
		if operation.kind == "replaceScriptSource" then
			operationRisk = if service == "ServerScriptService" or service == "ServerStorage"
				then "high"
				else "medium"
			table.insert(reasons, `Code changes under {service}`)
		elseif operation.kind == "createInstance" then
			operationRisk = "medium"
			if
				operation.target.className == "RemoteEvent"
				or operation.target.className == "RemoteFunction"
			then
				operationRisk = "high"
				table.insert(reasons, `Creates network boundary {operation.target.className}`)
			end
		end
		if RISK_RANK[operationRisk] > RISK_RANK[risk] then
			risk = operationRisk
		end
	end
	if #proposal.operations >= 50 then
		risk = "high"
		table.insert(reasons, `Broad proposal with {#proposal.operations} operations`)
	end
	local serviceList = {}
	for service in services do
		table.insert(serviceList, service)
	end
	table.sort(serviceList)
	if #reasons == 0 then
		table.insert(reasons, "Only allow-listed property changes")
	end
	return { risk = risk, reasons = reasons, services = serviceList, groups = groups }
end

return ReviewModel
