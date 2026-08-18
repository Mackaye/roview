--!strict

local ValueCodec = {}

function ValueCodec.decode(value: any): any
	if value.type == "boolean" or value.type == "number" or value.type == "string" then
		return value.value
	elseif value.type == "Color3" then
		return Color3.new(value.r, value.g, value.b)
	elseif value.type == "Vector3" then
		return Vector3.new(value.x, value.y, value.z)
	elseif value.type == "Enum" then
		local enumType = (Enum :: any)[value.enum]
		if not enumType then
			error(`Unsupported enum {value.enum}`)
		end
		local enumItem = enumType[value.item]
		if not enumItem then
			error(`Unsupported enum item {value.enum}.{value.item}`)
		end
		return enumItem
	end
	error(`Unsupported tagged value {tostring(value.type)}`)
end

function ValueCodec.equals(current: any, tagged: any): boolean
	local success, expected = pcall(ValueCodec.decode, tagged)
	return success and current == expected
end

return ValueCodec
