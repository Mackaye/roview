--!strict

export type Locator = {
	path: { string },
	className: string?,
}

local LocatorResolver = {}

function LocatorResolver.resolve(locator: Locator): (Instance?, string?)
	if #locator.path == 0 then
		return nil, "Locator path is empty"
	end

	local serviceSuccess, current = pcall(function()
		return game:GetService(locator.path[1])
	end)
	if not serviceSuccess or not current then
		return nil, `Service {locator.path[1]} is unavailable`
	end

	for index = 2, #locator.path do
		local segment = locator.path[index]
		local matches = {}
		for _, child in current:GetChildren() do
			if child.Name == segment then
				table.insert(matches, child)
			end
		end
		if #matches ~= 1 then
			return nil, `Expected one match for {segment}; found {#matches}`
		end
		current = matches[1]
	end

	if locator.className and current.ClassName ~= locator.className then
		return nil, `Expected {locator.className}; found {current.ClassName}`
	end
	return current, nil
end

return LocatorResolver
