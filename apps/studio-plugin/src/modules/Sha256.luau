--!strict

local bit = bit32
local MODULO = 2 ^ 32

local CONSTANTS = {
	0x428a2f98,
	0x71374491,
	0xb5c0fbcf,
	0xe9b5dba5,
	0x3956c25b,
	0x59f111f1,
	0x923f82a4,
	0xab1c5ed5,
	0xd807aa98,
	0x12835b01,
	0x243185be,
	0x550c7dc3,
	0x72be5d74,
	0x80deb1fe,
	0x9bdc06a7,
	0xc19bf174,
	0xe49b69c1,
	0xefbe4786,
	0x0fc19dc6,
	0x240ca1cc,
	0x2de92c6f,
	0x4a7484aa,
	0x5cb0a9dc,
	0x76f988da,
	0x983e5152,
	0xa831c66d,
	0xb00327c8,
	0xbf597fc7,
	0xc6e00bf3,
	0xd5a79147,
	0x06ca6351,
	0x14292967,
	0x27b70a85,
	0x2e1b2138,
	0x4d2c6dfc,
	0x53380d13,
	0x650a7354,
	0x766a0abb,
	0x81c2c92e,
	0x92722c85,
	0xa2bfe8a1,
	0xa81a664b,
	0xc24b8b70,
	0xc76c51a3,
	0xd192e819,
	0xd6990624,
	0xf40e3585,
	0x106aa070,
	0x19a4c116,
	0x1e376c08,
	0x2748774c,
	0x34b0bcb5,
	0x391c0cb3,
	0x4ed8aa4a,
	0x5b9cca4f,
	0x682e6ff3,
	0x748f82ee,
	0x78a5636f,
	0x84c87814,
	0x8cc70208,
	0x90befffa,
	0xa4506ceb,
	0xbef9a3f7,
	0xc67178f2,
}

local function add(a: number, b: number?, c: number?, d: number?, e: number?): number
	return (a + (b or 0) + (c or 0) + (d or 0) + (e or 0)) % MODULO
end

local function u32(bytes: { number }, offset: number): number
	return bytes[offset] * 2 ^ 24 + bytes[offset + 1] * 2 ^ 16 + bytes[offset + 2] * 2 ^ 8 + bytes[offset + 3]
end

local function digest(input: string): string
	local bytes = { string.byte(input, 1, #input) }
	local bitLength = #bytes * 8
	table.insert(bytes, 0x80)
	while #bytes % 64 ~= 56 do
		table.insert(bytes, 0)
	end

	local high = math.floor(bitLength / MODULO)
	local low = bitLength % MODULO
	for shift = 24, 0, -8 do
		table.insert(bytes, bit.band(bit.rshift(high, shift), 0xff))
	end
	for shift = 24, 0, -8 do
		table.insert(bytes, bit.band(bit.rshift(low, shift), 0xff))
	end

	local hash = {
		0x6a09e667,
		0xbb67ae85,
		0x3c6ef372,
		0xa54ff53a,
		0x510e527f,
		0x9b05688c,
		0x1f83d9ab,
		0x5be0cd19,
	}

	for chunk = 1, #bytes, 64 do
		local words = table.create(64, 0)
		for index = 1, 16 do
			words[index] = u32(bytes, chunk + (index - 1) * 4)
		end
		for index = 17, 64 do
			local left = words[index - 15]
			local right = words[index - 2]
			local sigma0 = bit.bxor(bit.rrotate(left, 7), bit.rrotate(left, 18), bit.rshift(left, 3))
			local sigma1 = bit.bxor(bit.rrotate(right, 17), bit.rrotate(right, 19), bit.rshift(right, 10))
			words[index] = add(words[index - 16], sigma0, words[index - 7], sigma1)
		end

		local a, b, c, d, e, f, g, h = table.unpack(hash)
		for index = 1, 64 do
			local sum1 = bit.bxor(bit.rrotate(e, 6), bit.rrotate(e, 11), bit.rrotate(e, 25))
			local choose = bit.bxor(bit.band(e, f), bit.band(bit.bnot(e), g))
			local temporary1 = add(h, sum1, choose, CONSTANTS[index], words[index])
			local sum0 = bit.bxor(bit.rrotate(a, 2), bit.rrotate(a, 13), bit.rrotate(a, 22))
			local majority = bit.bxor(bit.band(a, b), bit.band(a, c), bit.band(b, c))
			local temporary2 = add(sum0, majority)
			h, g, f, e, d, c, b, a = g, f, e, add(d, temporary1), c, b, a, add(temporary1, temporary2)
		end

		hash[1] = add(hash[1], a)
		hash[2] = add(hash[2], b)
		hash[3] = add(hash[3], c)
		hash[4] = add(hash[4], d)
		hash[5] = add(hash[5], e)
		hash[6] = add(hash[6], f)
		hash[7] = add(hash[7], g)
		hash[8] = add(hash[8], h)
	end

	local output = table.create(8)
	for index, value in hash do
		output[index] = string.format("%08x", value)
	end
	return table.concat(output)
end

return digest
