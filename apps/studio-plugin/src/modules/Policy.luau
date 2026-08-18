--!strict

local Policy = {}

Policy.AllowedClasses = {
	BindableEvent = true,
	BindableFunction = true,
	Configuration = true,
	Folder = true,
	RemoteEvent = true,
	RemoteFunction = true,
}

Policy.AllowedScriptClasses = {
	Script = true,
	LocalScript = true,
	ModuleScript = true,
}

Policy.AllowedPropertyTypes = {
	BackgroundColor3 = { Color3 = true },
	Enabled = { boolean = true },
	LayoutOrder = { number = true },
	Name = { string = true },
	Text = { string = true },
	TextColor3 = { Color3 = true },
	Value = { boolean = true, number = true, string = true, Color3 = true, Vector3 = true },
	Visible = { boolean = true },
}

function Policy.validateProperty(property: string, before: any, after: any): (boolean, string?)
	local types = Policy.AllowedPropertyTypes[property]
	if not types then
		return false, `property {property} is not allowed`
	end
	if typeof(before) ~= "table" or typeof(after) ~= "table" then
		return false, `property {property} requires tagged before and after values`
	end
	if before.type ~= after.type then
		return false, `property {property} before and after types differ`
	end
	if not types[before.type] then
		return false, `tagged type {tostring(before.type)} is not allowed for {property}`
	end
	return true, nil
end

return Policy
