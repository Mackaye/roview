--!strict
local Players = game:GetService("Players")

local DailyRewardsService = {
	cooldownHours = 24,
	baseCoins = 100,
}

function DailyRewardsService.getStreak(player: Player): number
	return player:GetAttribute("RewardStreak") or 1
end

function DailyRewardsService.canClaim(player: Player): boolean
	local lastClaim = player:GetAttribute("LastRewardClaim") or 0
	return (os.time() - lastClaim) >= (DailyRewardsService.cooldownHours * 3600)
end

return DailyRewardsService
