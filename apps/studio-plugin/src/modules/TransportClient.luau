--!strict

local HttpService = game:GetService("HttpService")

export type DiscoveredSession = {
	baseUrl: string,
	port: number,
	workspace: string,
	cwd: string,
	token: string,
	proposalCount: number,
	pid: number,
}

export type TransportClient = {
	baseUrl: string,
	token: string,
	cursor: number?,
	discover: (self: TransportClient, startPort: number?, endPort: number?) -> { DiscoveredSession },
	connectSession: (self: TransportClient, session: DiscoveredSession) -> (),
	getProposals: (self: TransportClient) -> (boolean, any),
	getInbox: (self: TransportClient, waitMs: number, forceSnapshot: boolean?) -> (boolean, any),
	pair: (self: TransportClient, pairingCode: string) -> (boolean, any),
	getReviewUrl: (self: TransportClient) -> string,
	post: (self: TransportClient, path: string, body: any) -> (boolean, any),
	decide: (self: TransportClient, record: any, kind: string, note: string) -> (boolean, any),
	reportPreflight: (self: TransportClient, record: any, errors: { string }) -> (boolean, any),
	beginApply: (self: TransportClient, record: any) -> (boolean, any),
	reportResult: (
		self: TransportClient,
		record: any,
		attemptId: string,
		success: boolean,
		message: string
	) -> (boolean, any),
}

local TransportClient = {}
TransportClient.__index = TransportClient

function TransportClient.new(baseUrl: string, token: string): TransportClient
	return setmetatable({
		baseUrl = string.gsub(baseUrl, "/+$", ""),
		token = token,
		cursor = nil,
	}, TransportClient) :: any
end

function TransportClient:discover(startPort: number?, endPort: number?): { DiscoveredSession }
	local firstPort = startPort or 3219
	local lastPort = endPort or 3225
	local discovered: { DiscoveredSession } = {}
	for port = firstPort, lastPort do
		local url = `http://127.0.0.1:{port}/v1/session`
		local success, response = pcall(function()
			return HttpService:RequestAsync({
				Url = url,
				Method = "GET",
			})
		end)
		if success and response.Success then
			local decodeSuccess, decoded = pcall(function()
				return HttpService:JSONDecode(response.Body)
			end)
			if decodeSuccess and decoded.protocolVersion == "0.1" and typeof(decoded.token) == "string" then
				table.insert(discovered, {
					baseUrl = `http://127.0.0.1:{port}`,
					port = port,
					workspace = decoded.workspace or `Session on port {port}`,
					cwd = decoded.cwd or "",
					token = decoded.token,
					proposalCount = decoded.proposalCount or 0,
					pid = decoded.pid or 0,
				})
			end
		end
	end
	return discovered
end

function TransportClient:connectSession(session: DiscoveredSession)
	self.baseUrl = session.baseUrl
	self.token = session.token
	self.cursor = nil
end

function TransportClient:decide(record: any, kind: string, note: string): (boolean, any)
	local proposal = record.proposal
	local comments = {}
	if note ~= "" then
		table.insert(comments, { body = note })
	end
	return self:post(
		`/v1/proposals/{HttpService:UrlEncode(proposal.proposalId)}/{proposal.revision}/decision`,
		{ kind = kind, comments = comments }
	)
end

function TransportClient:pair(pairingCode: string): (boolean, any)
	local pairedBaseUrl, code = string.match(pairingCode, "^(http://127%.0%.0%.1:%d+)|(.+)$")
	if pairedBaseUrl and code then
		self.baseUrl = pairedBaseUrl
		pairingCode = code
	end
	local success, response = pcall(function()
		return HttpService:RequestAsync({
			Url = self.baseUrl .. "/v1/pair",
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = HttpService:JSONEncode({ pairingCode = pairingCode }),
		})
	end)
	if not success then
		return false, "Could not reach the local companion."
	end
	local decodedSuccess, decoded = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not response.Success then
		return false, if decodedSuccess and decoded.error then decoded.error else "Pairing failed."
	end
	if not decodedSuccess or decoded.protocolVersion ~= "0.1" or typeof(decoded.token) ~= "string" then
		return false, "Companion protocol mismatch during pairing."
	end
	self.token = decoded.token
	self.cursor = nil
	return true, { token = decoded.token, baseUrl = self.baseUrl }
end

function TransportClient:getInbox(waitMs: number, forceSnapshot: boolean?): (boolean, any)
	if self.token == "" then
		return false, "Pair this plugin with the code printed by the companion."
	end
	local path = "/v1/plugin/inbox"
	if not forceSnapshot and self.cursor ~= nil then
		path ..= `?after={self.cursor}&waitMs={math.clamp(waitMs, 0, 25000)}`
	end
	local success, response = pcall(function()
		return HttpService:RequestAsync({
			Url = self.baseUrl .. path,
			Method = "GET",
			Headers = { Authorization = `Bearer {self.token}` },
		})
	end)
	if not success then
		return false, "Companion unavailable; reconnecting on loopback."
	end
	local decodedSuccess, decoded = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not response.Success then
		return false, `Companion returned HTTP {response.StatusCode}. Pair again if its token rotated.`
	end
	if not decodedSuccess or decoded.protocolVersion ~= "0.1" or typeof(decoded.cursor) ~= "number" then
		return false, "Companion protocol mismatch; update Roview before reconnecting."
	end
	self.cursor = decoded.cursor
	return true, decoded
end

function TransportClient:getReviewUrl(): string
	return `{self.baseUrl}/review?token={HttpService:UrlEncode(self.token)}`
end

function TransportClient:getProposals(): (boolean, any)
	local success, inbox = self:getInbox(0, true)
	if not success then
		return false, inbox
	end
	return true, inbox.proposals
end

function TransportClient:post(path: string, body: any): (boolean, any)
	local success, response = pcall(function()
		return HttpService:RequestAsync({
			Url = self.baseUrl .. path,
			Method = "POST",
			Headers = {
				Authorization = `Bearer {self.token}`,
				["Content-Type"] = "application/json",
			},
			Body = HttpService:JSONEncode(body),
		})
	end)
	if not success then
		return false, "Could not reach the local companion."
	end
	local decodedSuccess, decoded = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not response.Success then
		return false,
			if decodedSuccess and decoded.error
				then decoded.error
				else `Companion returned HTTP {response.StatusCode}.`
	end
	if not decodedSuccess then
		return false, "Companion returned an invalid response."
	end
	return true, decoded
end

function TransportClient:reportPreflight(record: any, errors: { string }, issues: { any }?): (boolean, any)
	local proposal = record.proposal
	return self:post(
		`/v1/plugin/proposals/{HttpService:UrlEncode(proposal.proposalId)}/{proposal.revision}/preflight`,
		{
			proposalDigest = record.digest,
			errors = errors,
			issues = issues or {},
		}
	)
end

function TransportClient:beginApply(record: any): (boolean, any)
	local proposal = record.proposal
	return self:post(
		`/v1/plugin/proposals/{HttpService:UrlEncode(proposal.proposalId)}/{proposal.revision}/begin-apply`,
		{
			proposalDigest = record.digest,
		}
	)
end

function TransportClient:reportResult(
	record: any,
	attemptId: string,
	success: boolean,
	message: string
): (boolean, any)
	local proposal = record.proposal
	return self:post(
		`/v1/plugin/proposals/{HttpService:UrlEncode(proposal.proposalId)}/{proposal.revision}/result`,
		{
			proposalDigest = record.digest,
			attemptId = attemptId,
			success = success,
			message = message,
		}
	)
end

return TransportClient
