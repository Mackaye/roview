--!strict

local GuiService = game:GetService("GuiService")
local Selection = game:GetService("Selection")

local ChangeExecutor = require(script.modules.ChangeExecutor)
local LocatorResolver = require(script.modules.LocatorResolver)
local PreflightValidator = require(script.modules.PreflightValidator)
local ProtocolValidator = require(script.modules.ProtocolValidator)
local ReviewWidget = require(script.modules.ReviewWidget)
local TransportClient = require(script.modules.TransportClient)

local BASE_URL = "http://127.0.0.1:3219"
local TOKEN_SETTING = "sessionToken"
local BASE_URL_SETTING = "companionBaseUrl"

local toolbar = plugin:CreateToolbar("Roview")
local toolbarButton = toolbar:CreateButton(
	"Roview",
	"Open Roview review IDE",
	"rbxthumb://type=Asset&id=121447948813202&w=150&h=150"
)
toolbarButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 380, 580, 320, 400)

local widget = plugin:CreateDockWidgetPluginGuiAsync("RoviewReview", widgetInfo)

local sessionToken = plugin:GetSetting(TOKEN_SETTING)
if typeof(sessionToken) ~= "string" then
	sessionToken = ""
end
local savedBaseUrl = plugin:GetSetting(BASE_URL_SETTING)
if typeof(savedBaseUrl) ~= "string" or not string.match(savedBaseUrl, "^http://127%.0%.0%.1:%d+$") then
	savedBaseUrl = BASE_URL
end
local client = TransportClient.new(savedBaseUrl, sessionToken)
local view: any
local latestRecords = {}

local function refresh(forceSnapshot: boolean?)
	local success, result = client:getInbox(0, forceSnapshot == true)
	if success then
		local records = result.proposals or latestRecords
		view:setConnection(true, `Connected · {#records} proposal(s)`, nil, client.baseUrl)
		if result.changed and result.proposals then
			latestRecords = result.proposals
			view:render(latestRecords)
		end
	else
		view:setConnection(false, result, nil, client.baseUrl)
	end
	return success
end

local function scanAndAutoConnect(showModalIfMultiple: boolean?): boolean
	local sessions = client:discover(3219, 3225)
	view:setDiscoveredSessions(sessions)
	if #sessions == 1 then
		local s = sessions[1]
		client:connectSession(s)
		sessionToken = s.token
		plugin:SetSetting(TOKEN_SETTING, sessionToken)
		plugin:SetSetting(BASE_URL_SETTING, s.baseUrl)
		view:setToken(sessionToken)
		view:setReviewUrl(client:getReviewUrl())
		view:setConnection(true, `Connected to {s.workspace} (port {s.port})`, s.workspace, s.baseUrl)
		refresh(true)
		return true
	elseif #sessions > 1 then
		if showModalIfMultiple then
			view:showConnectionModal()
		end
		view:setConnection(
			false,
			`Found {#sessions} active sessions. Click Session to choose.`,
			nil,
			client.baseUrl
		)
		return false
	else
		return false
	end
end

view = ReviewWidget.new(widget, {
	onRefresh = function()
		if not refresh(true) then
			scanAndAutoConnect(false)
		end
	end,
	onScanSessions = function()
		local sessions = client:discover(3219, 3225)
		view:setDiscoveredSessions(sessions)
		if #sessions == 0 then
			view:setStatus("No local Roview companion found on ports 3219–3225.", false)
		else
			view:setStatus(`Discovered {#sessions} local session(s).`, true)
		end
	end,
	onConnectSession = function(session: any)
		client:connectSession(session)
		sessionToken = session.token
		plugin:SetSetting(TOKEN_SETTING, sessionToken)
		plugin:SetSetting(BASE_URL_SETTING, session.baseUrl)
		view:setToken(sessionToken)
		view:setReviewUrl(client:getReviewUrl())
		view:setConnection(
			true,
			`Connected to {session.workspace} (port {session.port})`,
			session.workspace,
			session.baseUrl
		)
		refresh(true)
	end,
	onSaveToken = function(pairingCode: string)
		local paired, tokenOrError = client:pair(pairingCode)
		if not paired then
			view:setStatus(tokenOrError, false)
			return
		end
		sessionToken = tokenOrError.token
		plugin:SetSetting(TOKEN_SETTING, sessionToken)
		plugin:SetSetting(BASE_URL_SETTING, tokenOrError.baseUrl)
		view:setToken(sessionToken)
		view:setReviewUrl(client:getReviewUrl())
		view:setConnection(true, "Connected via pairing code", nil, tokenOrError.baseUrl)
		refresh(true)
	end,
	onOpenReview = function(): (boolean, string)
		local url = client:getReviewUrl()
		view:setReviewUrl(url)
		pcall(function()
			(GuiService :: any):OpenBrowserWindow(url)
		end)
		return true, `Review URL ready: {url}`
	end,
	onApply = function(record: any): (boolean, string)
		local valid, validationMessage = ProtocolValidator.validateRecord(record)
		if not valid then
			return false, validationMessage
		end
		local preflight = PreflightValidator.validate(record.proposal)
		local reported, reportResponse = client:reportPreflight(record, preflight.errors, preflight.issues)
		if not reported then
			return false, `Preflight could not be reported: {reportResponse}`
		end
		if not preflight.ok then
			refresh()
			return false, table.concat(preflight.errors, "\n")
		end

		local began, applyingRecord = client:beginApply(reportResponse)
		if not began then
			refresh()
			return false, `Apply could not begin: {applyingRecord}`
		end
		if applyingRecord.status ~= "APPLYING" then
			refresh()
			return false,
				`Companion refused a new apply attempt because this revision is {applyingRecord.status}.`
		end
		local attemptId = applyingRecord.applyAttempt.attemptId
		local executed, success, message = pcall(ChangeExecutor.apply, record.proposal)
		if not executed then
			message =
				`Apply crashed before a complete result: {tostring(success)}. Inspect Studio and use Undo if needed.`
			success = false
		end
		local resultReported, resultResponse =
			client:reportResult(applyingRecord, attemptId, success, message)
		refresh()
		if not resultReported then
			return false, `{message} Result reporting failed: {resultResponse}`
		end
		return success, message
	end,
	onDecision = function(record: any, kind: string, note: string): (boolean, string)
		if record.status ~= "READY_FOR_REVIEW" or #record.proposal.operations > 20 then
			return false, "Use full review for proposals with more than 20 operations."
		end
		local decided, response = client:decide(record, kind, note)
		if not decided then
			return false, response
		end
		refresh(true)
		if kind == "APPROVE" then
			return true, "Approved exact digest for Studio preflight; not applied yet."
		elseif kind == "REQUEST_CHANGES" then
			return true, "Changes requested; feedback returned to the producer."
		end
		return true, "Proposal rejected; no Studio mutation is permitted."
	end,
	onSelectTarget = function(operation: any)
		local locator = if operation.kind == "createInstance"
			then operation.target.parent
			else operation.target
		local target, resolveError = LocatorResolver.resolve(locator)
		if target then
			Selection:Set({ target })
		else
			view:setStatus(resolveError or "Target unavailable", false)
		end
	end,
})

view:setToken(sessionToken)
view:setReviewUrl(client:getReviewUrl())

-- On launch: try connecting with saved token, or auto-discover local sessions
if sessionToken ~= "" then
	local ok = refresh(true)
	if not ok then
		scanAndAutoConnect(false)
	end
else
	scanAndAutoConnect(false)
end

toolbarButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
	if widget.Enabled then
		if sessionToken == "" or not refresh(true) then
			scanAndAutoConnect(false)
		end
	end
end)

local alive = true
plugin.Unloading:Connect(function()
	alive = false
end)

task.spawn(function()
	while alive do
		if sessionToken == "" then
			scanAndAutoConnect(false)
			task.wait(3)
		else
			local success, result = client:getInbox(20000, false)
			if success then
				if result.changed and result.proposals then
					latestRecords = result.proposals
					view:render(latestRecords)
				end
				view:setConnection(true, `Connected · {#latestRecords} proposal(s)`, nil, client.baseUrl)
			else
				view:setConnection(false, result, nil, client.baseUrl)
				-- If connection was lost, attempt discovery on port range
				task.wait(2)
				scanAndAutoConnect(false)
				task.wait(2)
			end
		end
	end
end)
