--!strict

return function(Policy: any)
	assert(Policy.AllowedClasses.Folder, "Folder should be allowed")
	assert(not Policy.AllowedClasses.Script, "arbitrary Script creation must be blocked")

	local allowed = Policy.validateProperty(
		"BackgroundColor3",
		{ type = "Color3", r = 0, g = 0, b = 0 },
		{ type = "Color3", r = 1, g = 1, b = 1 }
	)
	assert(allowed, "reviewed Color3 property should be allowed")

	local unsupported = Policy.validateProperty(
		"CFrame",
		{ type = "string", value = "opaque" },
		{ type = "string", value = "opaque" }
	)
	assert(not unsupported, "CFrame is outside the prototype property policy")
end
