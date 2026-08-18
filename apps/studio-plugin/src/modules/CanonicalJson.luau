--!strict

local HttpService = game:GetService("HttpService")

local CanonicalJson = {}

local function isArray(value: { [any]: any }): boolean
	local count = 0
	local maximum = 0
	for key in value do
		if typeof(key) ~= "number" or key < 1 or key % 1 ~= 0 then
			return false
		end
		count += 1
		maximum = math.max(maximum, key)
	end
	return count == maximum
end

local function encode(value: any): string
	local valueType = typeof(value)
	if valueType ~= "table" then
		return HttpService:JSONEncode(value)
	end
	if isArray(value) then
		local encoded = {}
		for _, item in value do
			table.insert(encoded, encode(item))
		end
		return "[" .. table.concat(encoded, ",") .. "]"
	end
	local keys = {}
	for key in value do
		if typeof(key) ~= "string" then
			error("Canonical objects require string keys")
		end
		table.insert(keys, key)
	end
	table.sort(keys)
	local encoded = {}
	for _, key in keys do
		table.insert(encoded, HttpService:JSONEncode(key) .. ":" .. encode(value[key]))
	end
	return "{" .. table.concat(encoded, ",") .. "}"
end

CanonicalJson.encode = encode

return CanonicalJson
