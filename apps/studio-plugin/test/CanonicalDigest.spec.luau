--!strict

return function(dependencies: any)
	local encoded = dependencies.CanonicalJson.encode({ b = 2, a = 1 })
	assert(encoded == '{"a":1,"b":2}', encoded)
	assert(
		dependencies.Sha256(encoded) == "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
		"Luau canonical digest must match the TypeScript fixture"
	)
end
