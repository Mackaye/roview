--!strict

local COLORS = {
	canvas = Color3.fromRGB(24, 26, 29),
	sidebar = Color3.fromRGB(30, 33, 37),
	surface = Color3.fromRGB(36, 39, 44),
	raised = Color3.fromRGB(45, 49, 55),
	subtle = Color3.fromRGB(20, 22, 25),
	border = Color3.fromRGB(52, 56, 62),
	rule = Color3.fromRGB(48, 52, 58),
	text = Color3.fromRGB(235, 237, 240),
	muted = Color3.fromRGB(150, 156, 166),
	accent = Color3.fromRGB(88, 166, 255),
	amber = Color3.fromRGB(217, 139, 43),
	green = Color3.fromRGB(46, 160, 67),
	red = Color3.fromRGB(218, 54, 51),
	diffAdd = Color3.fromRGB(22, 48, 30),
	diffAddText = Color3.fromRGB(126, 231, 135),
	diffRemove = Color3.fromRGB(54, 24, 26),
	diffRemoveText = Color3.fromRGB(255, 123, 114),
	commentBg = Color3.fromRGB(33, 38, 45),
	commentBorder = Color3.fromRGB(68, 76, 86),
}

local ReviewModel = require(script.Parent.ReviewModel)

export type Callbacks = {
	onRefresh: () -> (),
	onSaveToken: (string) -> (),
	onConnectSession: (any) -> (),
	onScanSessions: () -> (),
	onOpenReview: () -> (boolean, string),
	onApply: (any) -> (boolean, string),
	onDecision: (any, string, string) -> (boolean, string),
	onSelectTarget: (any) -> (),
}

export type LineAnnotation = {
	id: string,
	operationId: string?,
	path: string,
	side: string,
	line: number,
	author: string,
	body: string,
	createdAt: string,
}

local ReviewWidget = {}
ReviewWidget.__index = ReviewWidget

local function corner(parent: Instance, radius: number?)
	local item = Instance.new("UICorner")
	item.CornerRadius = UDim.new(0, radius or 6)
	item.Parent = parent
end

local function padding(parent: Instance, amount: number)
	local item = Instance.new("UIPadding")
	item.PaddingBottom = UDim.new(0, amount)
	item.PaddingLeft = UDim.new(0, amount)
	item.PaddingRight = UDim.new(0, amount)
	item.PaddingTop = UDim.new(0, amount)
	item.Parent = parent
end

local function label(parent: Instance, text: string, size: number, color: Color3): TextLabel
	local item = Instance.new("TextLabel")
	item.BackgroundTransparency = 1
	item.Font = Enum.Font.BuilderSans
	item.Text = text
	item.TextColor3 = color
	item.TextSize = size
	item.TextWrapped = true
	item.TextXAlignment = Enum.TextXAlignment.Left
	item.TextYAlignment = Enum.TextYAlignment.Center
	item.Parent = parent
	return item
end

local function button(parent: Instance, text: string, background: Color3): TextButton
	local item = Instance.new("TextButton")
	item.AutoButtonColor = true
	item.BackgroundColor3 = background
	item.BorderSizePixel = 0
	item.Font = Enum.Font.BuilderSansBold
	item.Text = text
	item.TextColor3 = COLORS.text
	item.TextSize = 13
	item.Parent = parent
	corner(item, 5)
	return item
end

local function setButtonEnabled(item: TextButton, enabled: boolean, background: Color3)
	item.Active = enabled
	item.AutoButtonColor = enabled
	item.BackgroundColor3 = if enabled then background else COLORS.raised
	item.TextColor3 = if enabled then COLORS.text else COLORS.muted
end

function ReviewWidget.new(widget: DockWidgetPluginGui, callbacks: Callbacks)
	widget.Title = "Roview — Review IDE"
	local self = setmetatable({
		widget = widget,
		callbacks = callbacks,
		records = {},
		selected = nil,
		selectedItemKey = "plan",
		viewed = {} :: { [string]: boolean },
		annotations = {} :: { LineAnnotation },
		connected = false,
		sessionName = "",
		discoveredSessions = {} :: { any },
		currentBaseUrl = "http://127.0.0.1:3219",
		reviewUrl = "",
		diffViewMode = "split",
		isDragging = false,
		dragStartLine = nil :: number?,
		dragCurrentLine = nil :: number?,
		dragSide = nil :: string?,
		dragOpId = nil :: string?,
		dragPath = nil :: string?,
		renderedLineCells = {} :: { { frame: Frame, side: string, line: number, baseColor: Color3 } },
	}, ReviewWidget)

	local root = Instance.new("Frame")
	root.BackgroundColor3 = COLORS.canvas
	root.BorderSizePixel = 0
	root.ClipsDescendants = true
	root.Size = UDim2.fromScale(1, 1)
	root.Parent = widget
	self.root = root

	-- Global mouse release to complete click-and-drag range selection
	root.InputEnded:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 and self.isDragging then
			self.isDragging = false
			local startL = self.dragStartLine
			local endL = self.dragCurrentLine
			if startL and endL then
				local rangeStart = math.min(startL, endL)
				local rangeEnd = math.max(startL, endL)
				self:openCommentDialog(
					self.dragPath or "",
					rangeStart,
					rangeEnd,
					self.dragSide or "after",
					self.dragOpId
				)
			end
			self:clearDragHighlight()
		end
	end)

	-- Top Action Bar (Height: 44px)
	local topBar = Instance.new("Frame")
	topBar.BackgroundColor3 = COLORS.sidebar
	topBar.BorderSizePixel = 0
	topBar.Position = UDim2.fromOffset(0, 0)
	topBar.Size = UDim2.new(1, 0, 0, 44)
	topBar.Parent = root
	self.topBar = topBar

	local brandLabel = label(topBar, "ROVIEW", 15, COLORS.text)
	brandLabel.Font = Enum.Font.BuilderSansBold
	brandLabel.Position = UDim2.fromOffset(14, 0)
	brandLabel.Size = UDim2.new(0, 70, 1, 0)

	local versionPill = Instance.new("Frame")
	versionPill.BackgroundColor3 = COLORS.surface
	versionPill.BorderSizePixel = 0
	versionPill.Position = UDim2.fromOffset(88, 12)
	versionPill.Size = UDim2.fromOffset(48, 20)
	versionPill.Parent = topBar
	corner(versionPill, 4)

	local versionLabel = label(versionPill, "v0.1.0", 11, COLORS.muted)
	versionLabel.Font = Enum.Font.BuilderSansMedium
	versionLabel.Size = UDim2.fromScale(1, 1)
	versionLabel.TextXAlignment = Enum.TextXAlignment.Center

	local breadcrumb = label(topBar, "Waiting for proposal...", 14, COLORS.muted)
	breadcrumb.Font = Enum.Font.BuilderSans
	breadcrumb.Position = UDim2.fromOffset(146, 0)
	breadcrumb.Size = UDim2.fromScale(0.32, 1)
	breadcrumb.TextTruncate = Enum.TextTruncate.AtEnd
	self.breadcrumb = breadcrumb

	-- Top Action Buttons (Right-aligned)
	local sessionBtn = button(topBar, "⚙️ Session", COLORS.raised)
	sessionBtn.Position = UDim2.new(1, -534, 0, 7)
	sessionBtn.Size = UDim2.fromOffset(98, 30)
	sessionBtn.TextSize = 12
	sessionBtn.Activated:Connect(function()
		self:toggleConnectionModal()
	end)
	self.sessionBtn = sessionBtn

	local modeToggle = button(topBar, "Split", COLORS.raised)
	modeToggle.Position = UDim2.new(1, -430, 0, 7)
	modeToggle.Size = UDim2.fromOffset(74, 30)
	modeToggle.TextSize = 12
	modeToggle.Activated:Connect(function()
		self.diffViewMode = if self.diffViewMode == "split" then "unified" else "split"
		modeToggle.Text = if self.diffViewMode == "split" then "Split" else "Unified"
		self:renderActiveItem()
	end)
	self.modeToggle = modeToggle

	local refreshBtn = button(topBar, "↻", COLORS.raised)
	refreshBtn.Position = UDim2.new(1, -372, 0, 7)
	refreshBtn.Size = UDim2.fromOffset(34, 30)
	refreshBtn.TextSize = 15
	refreshBtn.Activated:Connect(callbacks.onRefresh)

	local reqChangesBtn = button(topBar, "Send Feedback", COLORS.amber)
	reqChangesBtn.Position = UDim2.new(1, -332, 0, 7)
	reqChangesBtn.Size = UDim2.fromOffset(110, 30)
	reqChangesBtn.TextSize = 12
	reqChangesBtn.Activated:Connect(function()
		if not self.selected then
			return
		end
		local noteText = self.decisionNote.Text
		if #self.annotations > 0 and noteText == "" then
			noteText = `Review requested with {#self.annotations} inline comments.`
		end
		if noteText == "" then
			self:setStatus("Enter feedback in the note box before requesting changes", false)
			self.decisionNote:CaptureFocus()
			return
		end
		local success, msg = callbacks.onDecision(self.selected, "REQUEST_CHANGES", noteText)
		self:setStatus(msg, success)
	end)
	self.reqChangesBtn = reqChangesBtn

	local rejectBtn = button(topBar, "Reject", COLORS.red)
	rejectBtn.Position = UDim2.new(1, -216, 0, 7)
	rejectBtn.Size = UDim2.fromOffset(74, 30)
	rejectBtn.TextSize = 12
	rejectBtn.Activated:Connect(function()
		if not self.selected then
			return
		end
		local success, msg = callbacks.onDecision(self.selected, "REJECT", self.decisionNote.Text)
		self:setStatus(msg, success)
	end)
	self.rejectBtn = rejectBtn

	local approveBtn = button(topBar, "Approve", COLORS.green)
	approveBtn.Position = UDim2.new(1, -136, 0, 7)
	approveBtn.Size = UDim2.fromOffset(122, 30)
	approveBtn.TextSize = 13
	approveBtn.Activated:Connect(function()
		if not self.selected then
			return
		end
		if self.selected.status == "APPROVED" then
			local success, msg = callbacks.onApply(self.selected)
			self:setStatus(msg, success)
			return
		end
		local success, msg = callbacks.onDecision(self.selected, "APPROVE", self.decisionNote.Text)
		self:setStatus(msg, success)
	end)
	self.approveBtn = approveBtn

	-- Token / Connection Bar (Shows when not connected)
	local tokenBar = Instance.new("Frame")
	tokenBar.BackgroundColor3 = COLORS.surface
	tokenBar.BorderSizePixel = 0
	tokenBar.Position = UDim2.fromOffset(0, 44)
	tokenBar.Size = UDim2.new(1, 0, 0, 38)
	tokenBar.Parent = root
	self.tokenBar = tokenBar

	local tokenBox = Instance.new("TextBox")
	tokenBox.BackgroundColor3 = COLORS.raised
	tokenBox.BorderSizePixel = 0
	tokenBox.ClearTextOnFocus = false
	tokenBox.Font = Enum.Font.RobotoMono
	tokenBox.PlaceholderText = "Paste one-use pairing token from companion..."
	tokenBox.PlaceholderColor3 = COLORS.muted
	tokenBox.Position = UDim2.fromOffset(12, 4)
	tokenBox.Size = UDim2.new(1, -126, 0, 30)
	tokenBox.Text = ""
	tokenBox.TextColor3 = COLORS.text
	tokenBox.TextSize = 13
	tokenBox.TextXAlignment = Enum.TextXAlignment.Left
	tokenBox.Parent = tokenBar
	corner(tokenBox, 4)
	padding(tokenBox, 6)
	self.tokenBox = tokenBox

	local connectBtn = button(tokenBar, "Connect", COLORS.amber)
	connectBtn.Position = UDim2.new(1, -106, 0, 4)
	connectBtn.Size = UDim2.fromOffset(94, 30)
	connectBtn.TextSize = 13
	connectBtn.Activated:Connect(function()
		if tokenBox.Text ~= "" then
			callbacks.onSaveToken(tokenBox.Text)
		end
	end)

	-- Note / Status Footer Bar (Height: 36px)
	local footerBar = Instance.new("Frame")
	footerBar.BackgroundColor3 = COLORS.sidebar
	footerBar.BorderSizePixel = 0
	footerBar.Position = UDim2.new(0, 0, 1, -36)
	footerBar.Size = UDim2.new(1, 0, 0, 36)
	footerBar.Parent = root
	self.footerBar = footerBar

	local statusLabel = label(footerBar, "Not connected", 12, COLORS.muted)
	statusLabel.Position = UDim2.fromOffset(14, 0)
	statusLabel.Size = UDim2.fromScale(0.38, 1)
	statusLabel.TextTruncate = Enum.TextTruncate.AtEnd
	self.status = statusLabel

	local decisionNote = Instance.new("TextBox")
	decisionNote.BackgroundColor3 = COLORS.raised
	decisionNote.BorderSizePixel = 0
	decisionNote.ClearTextOnFocus = false
	decisionNote.Font = Enum.Font.BuilderSans
	decisionNote.PlaceholderColor3 = COLORS.muted
	decisionNote.PlaceholderText = "Optional decision note / feedback to AI agent..."
	decisionNote.Position = UDim2.new(0.4, 0, 0, 4)
	decisionNote.Size = UDim2.new(0.58, 0, 0, 28)
	decisionNote.Text = ""
	decisionNote.TextColor3 = COLORS.text
	decisionNote.TextSize = 12
	decisionNote.TextXAlignment = Enum.TextXAlignment.Left
	decisionNote.Parent = footerBar
	corner(decisionNote, 4)
	padding(decisionNote, 4)
	self.decisionNote = decisionNote

	-- Main Workspace Area
	local workspace = Instance.new("Frame")
	workspace.BackgroundTransparency = 1
	workspace.BorderSizePixel = 0
	workspace.Parent = root
	self.workspace = workspace

	-- Left Sidebar: Explorer (Width: 260px)
	local explorer = Instance.new("Frame")
	explorer.BackgroundColor3 = COLORS.sidebar
	explorer.BorderSizePixel = 0
	explorer.Position = UDim2.fromOffset(0, 0)
	explorer.Size = UDim2.new(0, 260, 1, 0)
	explorer.Parent = workspace
	self.explorer = explorer

	-- Proposal Switcher Area in Explorer Sidebar
	local propSection = Instance.new("Frame")
	propSection.BackgroundTransparency = 1
	propSection.Position = UDim2.fromOffset(8, 6)
	propSection.Size = UDim2.new(1, -16, 0, 56)
	propSection.Parent = explorer

	local propSectionHeader = label(propSection, "ACTIVE PROPOSAL", 10, COLORS.muted)
	propSectionHeader.Font = Enum.Font.BuilderSansBold
	propSectionHeader.Position = UDim2.fromOffset(2, 0)
	propSectionHeader.Size = UDim2.new(1, -4, 0, 16)

	local propSelectBtn = button(propSection, "Select Proposal...", COLORS.surface)
	propSelectBtn.Position = UDim2.fromOffset(0, 18)
	propSelectBtn.Size = UDim2.new(1, 0, 0, 34)
	propSelectBtn.TextSize = 11
	propSelectBtn.TextXAlignment = Enum.TextXAlignment.Left
	propSelectBtn.TextTruncate = Enum.TextTruncate.AtEnd
	propSelectBtn.Parent = propSection
	corner(propSelectBtn, 4)
	padding(propSelectBtn, 6)
	propSelectBtn.Activated:Connect(function()
		self:openProposalModal()
	end)
	self.propSelectBtn = propSelectBtn

	local explorerHeader = Instance.new("Frame")
	explorerHeader.BackgroundTransparency = 1
	explorerHeader.Position = UDim2.fromOffset(8, 66)
	explorerHeader.Size = UDim2.new(1, -16, 0, 22)
	explorerHeader.Parent = explorer

	local explorerTitle = label(explorerHeader, "CHANGES / FILES", 10, COLORS.muted)
	explorerTitle.Font = Enum.Font.BuilderSansBold
	explorerTitle.Size = UDim2.fromScale(0.6, 1)

	local viewedCountBadge = label(explorerHeader, "0/0", 11, COLORS.muted)
	viewedCountBadge.Font = Enum.Font.RobotoMono
	viewedCountBadge.Position = UDim2.fromScale(0.6, 0)
	viewedCountBadge.Size = UDim2.fromScale(0.4, 1)
	viewedCountBadge.TextXAlignment = Enum.TextXAlignment.Right
	self.viewedCountBadge = viewedCountBadge

	local fileList = Instance.new("ScrollingFrame")
	fileList.AutomaticCanvasSize = Enum.AutomaticSize.Y
	fileList.BackgroundTransparency = 1
	fileList.BorderSizePixel = 0
	fileList.CanvasSize = UDim2.new()
	fileList.Position = UDim2.fromOffset(6, 92)
	fileList.ScrollBarImageColor3 = COLORS.muted
	fileList.ScrollBarThickness = 5
	fileList.Size = UDim2.new(1, -12, 1, -98)
	fileList.Parent = explorer
	local fileLayout = Instance.new("UIListLayout")
	fileLayout.Padding = UDim.new(0, 2)
	fileLayout.SortOrder = Enum.SortOrder.LayoutOrder
	fileLayout.Parent = fileList
	self.fileList = fileList

	-- Vertical Divider
	local vDivider = Instance.new("Frame")
	vDivider.BackgroundColor3 = COLORS.border
	vDivider.BorderSizePixel = 0
	vDivider.Position = UDim2.fromOffset(260, 0)
	vDivider.Size = UDim2.new(0, 1, 1, 0)
	vDivider.Parent = workspace
	self.vDivider = vDivider

	-- Right Area: Diff Editor Pane
	local editor = Instance.new("Frame")
	editor.BackgroundColor3 = COLORS.canvas
	editor.BorderSizePixel = 0
	editor.Position = UDim2.fromOffset(261, 0)
	editor.Size = UDim2.new(1, -261, 1, 0)
	editor.Parent = workspace
	self.editor = editor

	-- IDE Tab Bar (Height: 36px)
	local tabBar = Instance.new("Frame")
	tabBar.BackgroundColor3 = COLORS.sidebar
	tabBar.BorderSizePixel = 0
	tabBar.Position = UDim2.fromOffset(0, 0)
	tabBar.Size = UDim2.new(1, 0, 0, 36)
	tabBar.Parent = editor
	self.tabBar = tabBar

	local activeTab = Instance.new("Frame")
	activeTab.BackgroundColor3 = COLORS.canvas
	activeTab.BorderSizePixel = 0
	activeTab.Position = UDim2.fromOffset(0, 0)
	activeTab.Size = UDim2.new(0, 240, 1, 0)
	activeTab.Parent = tabBar

	local tabIcon = label(activeTab, "📜", 15, COLORS.text)
	tabIcon.Position = UDim2.fromOffset(12, 0)
	tabIcon.Size = UDim2.new(0, 22, 1, 0)
	self.tabIcon = tabIcon

	local tabLabel = label(activeTab, "plan.md", 13, COLORS.text)
	tabLabel.Font = Enum.Font.BuilderSansBold
	tabLabel.Position = UDim2.fromOffset(36, 0)
	tabLabel.Size = UDim2.new(1, -80, 1, 0)
	tabLabel.TextTruncate = Enum.TextTruncate.AtEnd
	self.tabLabel = tabLabel

	local tabStatus = label(activeTab, "M", 11, COLORS.accent)
	tabStatus.Font = Enum.Font.BuilderSansBold
	tabStatus.Position = UDim2.new(1, -36, 0, 0)
	tabStatus.Size = UDim2.new(0, 28, 1, 0)
	tabStatus.TextXAlignment = Enum.TextXAlignment.Center
	self.tabStatus = tabStatus

	-- Tab Tools (Right side of Tab Bar)
	local viewedToggleBtn = button(tabBar, "○ Mark viewed", COLORS.raised)
	viewedToggleBtn.Position = UDim2.new(1, -216, 0, 4)
	viewedToggleBtn.Size = UDim2.fromOffset(110, 28)
	viewedToggleBtn.TextSize = 11
	viewedToggleBtn.Activated:Connect(function()
		local cur = self:getCurrentItem()
		if cur then
			self.viewed[cur.key] = not self.viewed[cur.key]
			self:renderExplorer()
			self:renderActiveItem()
		end
	end)
	self.viewedToggleBtn = viewedToggleBtn

	local copyDiffBtn = button(tabBar, "Copy diff", COLORS.surface)
	copyDiffBtn.Position = UDim2.new(1, -98, 0, 4)
	copyDiffBtn.Size = UDim2.fromOffset(88, 28)
	copyDiffBtn.TextSize = 11
	copyDiffBtn.Activated:Connect(function()
		local cur = self:getCurrentItem()
		if not cur or not cur.operation then
			return
		end
		local sources = ReviewModel.operationSources(cur.operation)
		local raw = ReviewModel.rawDiff(sources.before, sources.after)
		local lines = {}
		for _, token in raw do
			local prefix = if token.kind == "added" then "+" elseif token.kind == "removed" then "-" else " "
			table.insert(lines, `{prefix}{token.text}`)
		end
		local studioService = game:GetService("StudioService") :: any
		local copied = pcall(function()
			studioService:CopyToClipboard(table.concat(lines, "\n"))
		end)
		if copied then
			self:setStatus("Diff copied to clipboard!", true)
		else
			self:setStatus("Clipboard copy not supported", false)
		end
	end)
	self.copyDiffBtn = copyDiffBtn

	-- Rationale Bar
	local rationaleBar = Instance.new("Frame")
	rationaleBar.BackgroundColor3 = COLORS.surface
	rationaleBar.BorderSizePixel = 0
	rationaleBar.Position = UDim2.fromOffset(0, 36)
	rationaleBar.Size = UDim2.new(1, 0, 0, 28)
	rationaleBar.Parent = editor
	padding(rationaleBar, 4)

	local rationaleText = label(rationaleBar, "", 12, COLORS.muted)
	rationaleText.Position = UDim2.fromOffset(10, 0)
	rationaleText.Size = UDim2.new(1, -20, 1, 0)
	rationaleText.TextTruncate = Enum.TextTruncate.AtEnd
	self.rationaleText = rationaleText

	-- Main Diff Scroll Area
	local editorScroll = Instance.new("ScrollingFrame")
	editorScroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
	editorScroll.BackgroundTransparency = 1
	editorScroll.BorderSizePixel = 0
	editorScroll.CanvasSize = UDim2.new()
	editorScroll.Position = UDim2.fromOffset(0, 64)
	editorScroll.ScrollBarImageColor3 = COLORS.muted
	editorScroll.ScrollBarThickness = 6
	editorScroll.Size = UDim2.new(1, 0, 1, -64)
	editorScroll.Parent = editor
	local editorLayout = Instance.new("UIListLayout")
	editorLayout.Padding = UDim.new(0, 1)
	editorLayout.SortOrder = Enum.SortOrder.LayoutOrder
	editorLayout.Parent = editorScroll
	self.editorScroll = editorScroll

	-- Inline Comment Popover Modal Frame
	local commentModal = Instance.new("Frame")
	commentModal.BackgroundColor3 = COLORS.commentBg
	commentModal.BorderSizePixel = 1
	commentModal.BorderColor3 = COLORS.commentBorder
	commentModal.Position = UDim2.new(0.5, -210, 0.28, 0)
	commentModal.Size = UDim2.fromOffset(420, 210)
	commentModal.Visible = false
	commentModal.ZIndex = 50
	commentModal.Parent = root
	corner(commentModal, 8)
	padding(commentModal, 10)
	self.commentModal = commentModal

	local modalHeader = label(commentModal, "💬 Add Inline Comment", 13, COLORS.text)
	modalHeader.Font = Enum.Font.BuilderSansBold
	modalHeader.Position = UDim2.fromOffset(4, 0)
	modalHeader.Size = UDim2.new(1, -36, 0, 22)
	modalHeader.ZIndex = 51
	self.modalHeader = modalHeader

	local closeCommentBtn = button(commentModal, "✕", COLORS.raised)
	closeCommentBtn.Position = UDim2.new(1, -24, 0, 0)
	closeCommentBtn.Size = UDim2.fromOffset(22, 22)
	closeCommentBtn.TextSize = 12
	closeCommentBtn.ZIndex = 51
	closeCommentBtn.Activated:Connect(function()
		commentModal.Visible = false
	end)

	local commentInput = Instance.new("TextBox")
	commentInput.BackgroundColor3 = COLORS.canvas
	commentInput.BorderSizePixel = 0
	commentInput.ClearTextOnFocus = false
	commentInput.Font = Enum.Font.BuilderSans
	commentInput.PlaceholderColor3 = COLORS.muted
	commentInput.PlaceholderText = "Type inline review feedback or suggestion..."
	commentInput.Position = UDim2.fromOffset(4, 28)
	commentInput.Size = UDim2.new(1, -8, 0, 84)
	commentInput.Text = ""
	commentInput.TextColor3 = COLORS.text
	commentInput.TextSize = 13
	commentInput.TextWrapped = true
	commentInput.TextXAlignment = Enum.TextXAlignment.Left
	commentInput.TextYAlignment = Enum.TextYAlignment.Top
	commentInput.ZIndex = 51
	commentInput.Parent = commentModal
	corner(commentInput, 4)
	padding(commentInput, 6)
	self.commentInput = commentInput

	-- Quick comment suggestion pills
	local pillContainer = Instance.new("Frame")
	pillContainer.BackgroundTransparency = 1
	pillContainer.Position = UDim2.fromOffset(4, 118)
	pillContainer.Size = UDim2.new(1, -8, 0, 28)
	pillContainer.ZIndex = 51
	pillContainer.Parent = commentModal

	local function addQuickPill(text: string, xPos: number, width: number, insertText: string)
		local p = button(pillContainer, text, COLORS.raised)
		p.Position = UDim2.fromOffset(xPos, 0)
		p.Size = UDim2.fromOffset(width, 24)
		p.TextSize = 11
		p.ZIndex = 52
		p.Activated:Connect(function()
			commentInput.Text = if commentInput.Text == ""
				then insertText
				else `{commentInput.Text} {insertText}`
		end)
	end
	addQuickPill("Revert", 0, 68, "Please revert this change.")
	addQuickPill("Refactor", 76, 82, "Consider refactoring for clarity.")
	addQuickPill("Edge case", 166, 90, "Does this handle nil / edge cases?")
	addQuickPill("Auth check", 264, 90, "Ensure proper permission check here.")

	local cancelCommentBtn = button(commentModal, "Cancel", COLORS.surface)
	cancelCommentBtn.Position = UDim2.new(1, -180, 1, -30)
	cancelCommentBtn.Size = UDim2.fromOffset(78, 28)
	cancelCommentBtn.TextSize = 12
	cancelCommentBtn.ZIndex = 51
	cancelCommentBtn.Activated:Connect(function()
		commentModal.Visible = false
	end)

	local saveCommentBtn = button(commentModal, "Add Comment", COLORS.green)
	saveCommentBtn.Position = UDim2.new(1, -94, 1, -30)
	saveCommentBtn.Size = UDim2.fromOffset(94, 28)
	saveCommentBtn.TextSize = 12
	saveCommentBtn.ZIndex = 51
	self.saveCommentBtn = saveCommentBtn

	-- Dedicated Connection & Session Modal (Overlay)
	local connOverlay = Instance.new("Frame")
	connOverlay.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
	connOverlay.BackgroundTransparency = 0.5
	connOverlay.BorderSizePixel = 0
	connOverlay.Size = UDim2.fromScale(1, 1)
	connOverlay.ZIndex = 70
	connOverlay.Visible = false
	connOverlay.Parent = root
	self.connOverlay = connOverlay

	local connModal = Instance.new("Frame")
	connModal.AnchorPoint = Vector2.new(0.5, 0.5)
	connModal.BackgroundColor3 = COLORS.sidebar
	connModal.BorderSizePixel = 1
	connModal.BorderColor3 = COLORS.border
	connModal.Position = UDim2.fromScale(0.5, 0.5)
	connModal.Size = UDim2.fromOffset(480, 410)
	connModal.ZIndex = 71
	connModal.Parent = connOverlay
	corner(connModal, 8)
	padding(connModal, 16)
	self.connModal = connModal

	local connTitle = label(connModal, "Roview Connection & Sessions (v0.1.0)", 15, COLORS.text)
	connTitle.Font = Enum.Font.BuilderSansBold
	connTitle.Position = UDim2.fromOffset(0, 0)
	connTitle.Size = UDim2.new(1, -36, 0, 24)
	connTitle.ZIndex = 72

	local connCloseBtn = button(connModal, "✕", COLORS.raised)
	connCloseBtn.Position = UDim2.new(1, -24, 0, 0)
	connCloseBtn.Size = UDim2.fromOffset(24, 24)
	connCloseBtn.TextSize = 13
	connCloseBtn.ZIndex = 72
	connCloseBtn.Activated:Connect(function()
		connOverlay.Visible = false
	end)

	-- Current status card
	local statusCard = Instance.new("Frame")
	statusCard.BackgroundColor3 = COLORS.surface
	statusCard.BorderSizePixel = 0
	statusCard.Position = UDim2.fromOffset(0, 32)
	statusCard.Size = UDim2.new(1, 0, 0, 54)
	statusCard.ZIndex = 72
	statusCard.Parent = connModal
	corner(statusCard, 6)
	padding(statusCard, 8)

	local connStatusLabel = label(statusCard, "Status: Not Connected", 13, COLORS.amber)
	connStatusLabel.Font = Enum.Font.BuilderSansBold
	connStatusLabel.Position = UDim2.fromOffset(4, 2)
	connStatusLabel.Size = UDim2.new(1, -8, 0, 20)
	connStatusLabel.ZIndex = 73
	self.connStatusLabel = connStatusLabel

	local connUrlLabel = label(statusCard, "Base URL: http://127.0.0.1:3219", 11, COLORS.muted)
	connUrlLabel.Position = UDim2.fromOffset(4, 24)
	connUrlLabel.Size = UDim2.new(1, -8, 0, 18)
	connUrlLabel.ZIndex = 73
	self.connUrlLabel = connUrlLabel

	-- Discovered Sessions Header
	local discHeader = label(connModal, "Discovered Local Sessions", 13, COLORS.text)
	discHeader.Font = Enum.Font.BuilderSansBold
	discHeader.Position = UDim2.fromOffset(0, 96)
	discHeader.Size = UDim2.new(1, -115, 0, 26)
	discHeader.ZIndex = 72

	local scanBtn = button(connModal, "↻ Scan Ports", COLORS.accent)
	scanBtn.Position = UDim2.new(1, -104, 0, 96)
	scanBtn.Size = UDim2.fromOffset(104, 26)
	scanBtn.TextSize = 11
	scanBtn.ZIndex = 72
	scanBtn.Activated:Connect(function()
		callbacks.onScanSessions()
	end)

	local sessionScroll = Instance.new("ScrollingFrame")
	sessionScroll.BackgroundColor3 = COLORS.canvas
	sessionScroll.BorderSizePixel = 0
	sessionScroll.CanvasSize = UDim2.new(0, 0, 0, 0)
	sessionScroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
	sessionScroll.Position = UDim2.fromOffset(0, 128)
	sessionScroll.ScrollBarThickness = 4
	sessionScroll.ScrollBarImageColor3 = COLORS.muted
	sessionScroll.Size = UDim2.new(1, 0, 0, 136)
	sessionScroll.ZIndex = 72
	sessionScroll.Parent = connModal
	corner(sessionScroll, 6)
	padding(sessionScroll, 6)
	self.sessionScroll = sessionScroll

	local sessionLayout = Instance.new("UIListLayout")
	sessionLayout.Padding = UDim.new(0, 6)
	sessionLayout.SortOrder = Enum.SortOrder.LayoutOrder
	sessionLayout.Parent = sessionScroll

	-- Manual Connection / Pairing Section
	local manualLabel = label(connModal, "Manual Connection / Pairing Code", 12, COLORS.muted)
	manualLabel.Font = Enum.Font.BuilderSansBold
	manualLabel.Position = UDim2.fromOffset(0, 274)
	manualLabel.Size = UDim2.new(1, 0, 0, 20)
	manualLabel.ZIndex = 72

	local modalTokenBox = Instance.new("TextBox")
	modalTokenBox.BackgroundColor3 = COLORS.raised
	modalTokenBox.BorderSizePixel = 0
	modalTokenBox.ClearTextOnFocus = false
	modalTokenBox.Font = Enum.Font.RobotoMono
	modalTokenBox.PlaceholderText = "Paste URL|PairingCode or Token..."
	modalTokenBox.PlaceholderColor3 = COLORS.muted
	modalTokenBox.Position = UDim2.fromOffset(0, 298)
	modalTokenBox.Size = UDim2.new(1, -100, 0, 32)
	modalTokenBox.Text = ""
	modalTokenBox.TextColor3 = COLORS.text
	modalTokenBox.TextSize = 12
	modalTokenBox.TextXAlignment = Enum.TextXAlignment.Left
	modalTokenBox.ZIndex = 72
	modalTokenBox.Parent = connModal
	corner(modalTokenBox, 4)
	padding(modalTokenBox, 6)
	self.modalTokenBox = modalTokenBox

	local modalConnectBtn = button(connModal, "Connect", COLORS.green)
	modalConnectBtn.Position = UDim2.new(1, -92, 0, 298)
	modalConnectBtn.Size = UDim2.fromOffset(92, 32)
	modalConnectBtn.TextSize = 12
	modalConnectBtn.ZIndex = 72
	modalConnectBtn.Activated:Connect(function()
		if modalTokenBox.Text ~= "" then
			callbacks.onSaveToken(modalTokenBox.Text)
			connOverlay.Visible = false
		end
	end)

	-- Proposal Switcher Modal Overlay
	local propOverlay = Instance.new("Frame")
	propOverlay.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
	propOverlay.BackgroundTransparency = 0.5
	propOverlay.BorderSizePixel = 0
	propOverlay.Size = UDim2.fromScale(1, 1)
	propOverlay.ZIndex = 80
	propOverlay.Visible = false
	propOverlay.Parent = root
	self.propOverlay = propOverlay

	local propModal = Instance.new("Frame")
	propModal.AnchorPoint = Vector2.new(0.5, 0.5)
	propModal.BackgroundColor3 = COLORS.sidebar
	propModal.BorderSizePixel = 1
	propModal.BorderColor3 = COLORS.border
	propModal.Position = UDim2.fromScale(0.5, 0.5)
	propModal.Size = UDim2.fromOffset(460, 360)
	propModal.ZIndex = 81
	propModal.Parent = propOverlay
	corner(propModal, 8)
	padding(propModal, 16)
	self.propModal = propModal

	local propTitle = label(propModal, "Switch Active Proposal", 15, COLORS.text)
	propTitle.Font = Enum.Font.BuilderSansBold
	propTitle.Position = UDim2.fromOffset(0, 0)
	propTitle.Size = UDim2.new(1, -36, 0, 24)
	propTitle.ZIndex = 82

	local propCloseBtn = button(propModal, "✕", COLORS.raised)
	propCloseBtn.Position = UDim2.new(1, -24, 0, 0)
	propCloseBtn.Size = UDim2.fromOffset(24, 24)
	propCloseBtn.TextSize = 13
	propCloseBtn.ZIndex = 82
	propCloseBtn.Activated:Connect(function()
		propOverlay.Visible = false
	end)

	local propScroll = Instance.new("ScrollingFrame")
	propScroll.BackgroundColor3 = COLORS.canvas
	propScroll.BorderSizePixel = 0
	propScroll.CanvasSize = UDim2.new(0, 0, 0, 0)
	propScroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
	propScroll.Position = UDim2.fromOffset(0, 36)
	propScroll.ScrollBarThickness = 4
	propScroll.ScrollBarImageColor3 = COLORS.muted
	propScroll.Size = UDim2.new(1, 0, 1, -36)
	propScroll.ZIndex = 82
	propScroll.Parent = propModal
	corner(propScroll, 6)
	padding(propScroll, 6)
	self.propScroll = propScroll

	local propLayout = Instance.new("UIListLayout")
	propLayout.Padding = UDim.new(0, 6)
	propLayout.SortOrder = Enum.SortOrder.LayoutOrder
	propLayout.Parent = propScroll

	local function updateLayout()
		local width = root.AbsoluteSize.X
		local height = root.AbsoluteSize.Y
		local topOffset = if self.tokenBar.Visible then 82 else 44
		local footerHeight = 36
		workspace.Position = UDim2.fromOffset(0, topOffset)
		workspace.Size = UDim2.new(1, 0, 0, math.max(100, height - topOffset - footerHeight))

		if width < 500 then
			self.diffViewMode = "unified"
			modeToggle.Text = "Unified"
		end
	end
	self.updateLayout = updateLayout
	root:GetPropertyChangedSignal("AbsoluteSize"):Connect(updateLayout)

	updateLayout()
	return self
end

function ReviewWidget:toggleConnectionModal()
	self.connOverlay.Visible = not self.connOverlay.Visible
	if self.connOverlay.Visible then
		self.callbacks.onScanSessions()
	end
end

function ReviewWidget:showConnectionModal()
	self.connOverlay.Visible = true
	self.callbacks.onScanSessions()
end

function ReviewWidget:hideConnectionModal()
	self.connOverlay.Visible = false
end

function ReviewWidget:setDiscoveredSessions(sessions: { any })
	self.discoveredSessions = sessions
	self:renderDiscoveredSessions()
end

function ReviewWidget:renderDiscoveredSessions()
	for _, child in self.sessionScroll:GetChildren() do
		if child:IsA("Frame") or child:IsA("TextLabel") then
			child:Destroy()
		end
	end

	if #self.discoveredSessions == 0 then
		local empty = label(
			self.sessionScroll,
			"No active Roview companion found on ports 3219–3225.\nStart `pnpm demo` or `pnpm dev` to auto-connect.",
			12,
			COLORS.muted
		)
		empty.Size = UDim2.new(1, -8, 0, 48)
		empty.TextWrapped = true
		empty.ZIndex = 73
		return
	end

	for i, session in self.discoveredSessions do
		local card = Instance.new("Frame")
		card.BackgroundColor3 = COLORS.surface
		card.BorderSizePixel = 0
		card.LayoutOrder = i
		card.Size = UDim2.new(1, 0, 0, 52)
		card.ZIndex = 73
		card.Parent = self.sessionScroll
		corner(card, 6)
		padding(card, 8)

		local isCurrent = (self.currentBaseUrl == session.baseUrl and self.connected)

		local nameLabel = label(card, `📦 {session.workspace or "Roview Project"}`, 13, COLORS.text)
		nameLabel.Font = Enum.Font.BuilderSansBold
		nameLabel.Position = UDim2.fromOffset(4, 4)
		nameLabel.Size = UDim2.new(1, -110, 0, 18)
		nameLabel.ZIndex = 74

		local detailLabel =
			label(card, `Port {session.port} · {session.proposalCount or 0} proposal(s)`, 11, COLORS.muted)
		detailLabel.Position = UDim2.fromOffset(4, 24)
		detailLabel.Size = UDim2.new(1, -110, 0, 16)
		detailLabel.ZIndex = 74

		local cBtn = button(
			card,
			if isCurrent then "Active" else "Connect",
			if isCurrent then COLORS.raised else COLORS.green
		)
		cBtn.Position = UDim2.new(1, -88, 0, 10)
		cBtn.Size = UDim2.fromOffset(88, 28)
		cBtn.TextSize = 11
		cBtn.ZIndex = 74
		if not isCurrent then
			cBtn.Activated:Connect(function()
				self.callbacks.onConnectSession(session)
				self.connOverlay.Visible = false
			end)
		end
	end
end

function ReviewWidget:openProposalModal()
	self:renderProposalList()
	self.propOverlay.Visible = true
end

function ReviewWidget:renderProposalList()
	for _, child in self.propScroll:GetChildren() do
		if not child:IsA("UIListLayout") then
			child:Destroy()
		end
	end

	local totalRecords = #self.records
	for i, record in self.records do
		local isCurrent = (
			self.selected
			and self.selected.proposal.proposalId == record.proposal.proposalId
			and self.selected.proposal.revision == record.proposal.revision
		)
		local isLatest = (i == totalRecords)

		local card = Instance.new("Frame")
		card.BackgroundColor3 = if isCurrent then COLORS.raised else COLORS.surface
		card.BorderSizePixel = 0
		card.LayoutOrder = totalRecords - i -- Newest at top
		card.Size = UDim2.new(1, 0, 0, 56)
		card.ZIndex = 83
		card.Parent = self.propScroll
		corner(card, 5)
		padding(card, 6)

		local titleText = if isLatest then `[🌟 LATEST] {record.proposal.title}` else record.proposal.title

		local title = label(card, titleText, 12, if isLatest then COLORS.accent else COLORS.text)
		title.Font = Enum.Font.BuilderSansBold
		title.Position = UDim2.fromOffset(4, 2)
		title.Size = UDim2.new(1, -96, 0, 18)
		title.TextTruncate = Enum.TextTruncate.AtEnd
		title.ZIndex = 84

		local timeStr = if record.proposal.createdAt
			then string.sub(record.proposal.createdAt, 12, 19) .. " UTC"
			else ""
		local sub =
			label(card, `Rev {record.proposal.revision} · {record.status} · {timeStr}`, 11, COLORS.muted)
		sub.Position = UDim2.fromOffset(4, 24)
		sub.Size = UDim2.new(1, -96, 0, 16)
		sub.ZIndex = 84

		local selBtn = button(
			card,
			if isCurrent then "Active" else "Select",
			if isCurrent then COLORS.raised else COLORS.green
		)
		selBtn.Position = UDim2.new(1, -84, 0, 12)
		selBtn.Size = UDim2.fromOffset(80, 28)
		selBtn.TextSize = 11
		selBtn.ZIndex = 84
		if not isCurrent then
			selBtn.Activated:Connect(function()
				self.selected = record
				self:render(self.records)
				self.propOverlay.Visible = false
			end)
		end
	end
end

function ReviewWidget:setToken(token: string)
	self.tokenBox.Text = token
	if self.modalTokenBox then
		self.modalTokenBox.Text = token
	end
end

function ReviewWidget:setReviewUrl(url: string)
	self.reviewUrl = url
end

function ReviewWidget:setConnection(
	connected: boolean,
	message: string,
	workspaceName: string?,
	baseUrl: string?
)
	self.connected = connected
	self.tokenBar.Visible = not connected
	self.status.Text = message
	self.status.TextColor3 = if connected then COLORS.green else COLORS.red
	if baseUrl then
		self.currentBaseUrl = baseUrl
	end
	if workspaceName then
		self.sessionName = workspaceName
	end
	if self.sessionBtn then
		if connected then
			self.sessionBtn.Text = if self.sessionName ~= ""
				then `● {self.sessionName}`
				else "● Connected"
			self.sessionBtn.TextColor3 = COLORS.green
		else
			self.sessionBtn.Text = "⚙️ Offline"
			self.sessionBtn.TextColor3 = COLORS.amber
		end
	end
	if self.connStatusLabel then
		if connected then
			self.connStatusLabel.Text =
				`Status: ● Connected to {self.sessionName ~= "" and self.sessionName or "Companion"}`
			self.connStatusLabel.TextColor3 = COLORS.green
		else
			self.connStatusLabel.Text = "Status: ○ Not Connected"
			self.connStatusLabel.TextColor3 = COLORS.amber
		end
	end
	if self.connUrlLabel then
		self.connUrlLabel.Text = `Base URL: {self.currentBaseUrl}`
	end
	self:renderDiscoveredSessions()
	self.updateLayout()
	self:updateActionState()
end

function ReviewWidget:setStatus(message: string, success: boolean)
	self.status.Text = message
	self.status.TextColor3 = if success then COLORS.green else COLORS.red
end

function ReviewWidget:getCurrentItem(): ReviewModel.ReviewItem?
	if not self.selected then
		return nil
	end
	local items = ReviewModel.createItems(self.selected)
	for _, item in items do
		if item.key == self.selectedItemKey then
			return item
		end
	end
	return items[1] or nil
end

function ReviewWidget:updateDragHighlight()
	if not self.dragStartLine or not self.dragCurrentLine or not self.dragSide then
		return
	end
	local minL = math.min(self.dragStartLine, self.dragCurrentLine)
	local maxL = math.max(self.dragStartLine, self.dragCurrentLine)
	local selectColor = Color3.fromRGB(36, 74, 115)

	for _, entry in self.renderedLineCells do
		if entry.side == self.dragSide then
			if entry.line >= minL and entry.line <= maxL then
				entry.frame.BackgroundColor3 = selectColor
			else
				entry.frame.BackgroundColor3 = entry.baseColor
			end
		end
	end
end

function ReviewWidget:clearDragHighlight()
	for _, entry in self.renderedLineCells do
		entry.frame.BackgroundColor3 = entry.baseColor
	end
end

function ReviewWidget:openCommentDialog(
	path: string,
	lineStart: number,
	lineEnd: number,
	side: string,
	operationId: string?
)
	local lineHeader = if lineStart == lineEnd then `line {lineStart}` else `lines {lineStart}–{lineEnd}`
	self.modalHeader.Text = `💬 Add Comment on {lineHeader} ({side})`
	self.commentInput.Text = ""
	self.commentModal.Visible = true

	local conn: RBXScriptConnection? = nil
	conn = self.saveCommentBtn.Activated:Connect(function()
		if conn then
			conn:Disconnect()
			conn = nil
		end
		if self.commentInput.Text ~= "" then
			local newAnnotation: LineAnnotation = {
				id = tostring(os.clock()),
				operationId = operationId,
				path = path,
				side = side,
				line = lineEnd,
				author = "Studio Reviewer",
				body = self.commentInput.Text,
				createdAt = os.date("%X"),
			}
			table.insert(self.annotations, newAnnotation)
			self.commentModal.Visible = false
			self:renderActiveItem()
			self:setStatus(`Added comment on {lineHeader}`, true)
		end
	end)
end

function ReviewWidget:getAnnotationsForLine(
	operationId: string?,
	line: number,
	side: string
): { LineAnnotation }
	local res = {}
	for _, ann in self.annotations do
		local opMatch = (ann.operationId == operationId) or (ann.operationId == nil and operationId == nil)
		local sideMatch = (ann.side == side) or (ann.side == "")
		if opMatch and sideMatch and ann.line == line then
			table.insert(res, ann)
		end
	end
	return res
end

function ReviewWidget:renderInlineCommentCard(
	parent: Instance,
	ann: LineAnnotation,
	layoutOrder: number?,
	side: string?
)
	local card = Instance.new("Frame")
	card.BackgroundColor3 = COLORS.commentBg
	card.BorderSizePixel = 1
	card.BorderColor3 = COLORS.commentBorder
	card.LayoutOrder = layoutOrder or 0
	card.Size = UDim2.new(1, -16, 0, 56)
	card.Parent = parent
	corner(card, 5)
	padding(card, 6)

	local sideLabel = if (side or ann.side) == "before"
		then "[Original] "
		elseif (side or ann.side) == "after" then "[Proposed] "
		else ""
	local lineLabel = if ann.line and ann.line > 0 then `Line {ann.line}` else ""
	local headerText = `💬 {ann.author} · {sideLabel}{lineLabel} · {ann.createdAt}`

	local header = label(card, headerText, 11, COLORS.accent)
	header.Font = Enum.Font.BuilderSansBold
	header.Position = UDim2.fromOffset(4, 0)
	header.Size = UDim2.new(1, -32, 0, 18)

	local delBtn = button(card, "✕", COLORS.raised)
	delBtn.Position = UDim2.new(1, -22, 0, 0)
	delBtn.Size = UDim2.fromOffset(18, 18)
	delBtn.TextSize = 11
	delBtn.Activated:Connect(function()
		for i, a in self.annotations do
			if a.id == ann.id then
				table.remove(self.annotations, i)
				break
			end
		end
		self:renderActiveItem()
	end)

	local body = label(card, ann.body, 13, COLORS.text)
	body.Position = UDim2.fromOffset(4, 20)
	body.Size = UDim2.new(1, -8, 0, 28)
end

function ReviewWidget:renderExplorer()
	for _, child in self.fileList:GetChildren() do
		if not child:IsA("UIListLayout") then
			child:Destroy()
		end
	end

	if not self.selected then
		return
	end

	local items = ReviewModel.createItems(self.selected)
	local viewedCount = 0
	for _, it in items do
		if self.viewed[it.key] then
			viewedCount += 1
		end
	end
	self.viewedCountBadge.Text = `{viewedCount}/{#items}`

	local currentGroup = ""
	local layoutOrder = 0

	for _, item in items do
		-- Render group heading if group changed
		if item.group ~= currentGroup and item.kind ~= "plan" then
			currentGroup = item.group
			layoutOrder += 1
			local groupLabel = label(self.fileList, string.upper(currentGroup), 11, COLORS.muted)
			groupLabel.Font = Enum.Font.BuilderSansBold
			groupLabel.LayoutOrder = layoutOrder
			groupLabel.Size = UDim2.new(1, 0, 0, 22)
		end

		layoutOrder += 1
		local isSelected = item.key == self.selectedItemKey
		local isViewed = self.viewed[item.key] == true
		local stats = ReviewModel.statsForItem(item, self.selected)

		local row = Instance.new("Frame")
		row.BackgroundColor3 = if isSelected
			then COLORS.raised
			else (if layoutOrder % 2 == 0 then COLORS.sidebar else COLORS.surface)
		row.BorderSizePixel = 0
		row.LayoutOrder = layoutOrder
		row.Size = UDim2.new(1, 0, 0, 30)
		row.Parent = self.fileList
		corner(row, 4)

		if isSelected then
			local ind = Instance.new("Frame")
			ind.BackgroundColor3 = COLORS.accent
			ind.BorderSizePixel = 0
			ind.Position = UDim2.fromOffset(0, 4)
			ind.Size = UDim2.fromOffset(3, 22)
			ind.Parent = row
			corner(ind, 2)
		end

		local clickBtn = Instance.new("TextButton")
		clickBtn.AutoButtonColor = true
		clickBtn.BackgroundTransparency = 1
		clickBtn.Position = UDim2.fromOffset(8, 0)
		clickBtn.Size = UDim2.new(1, -12, 1, 0)
		clickBtn.Font = Enum.Font.BuilderSans
		clickBtn.Text = ""
		clickBtn.Parent = row

		local iconLabel = label(clickBtn, item.icon, 14, COLORS.text)
		iconLabel.Position = UDim2.fromOffset(0, 0)
		iconLabel.Size = UDim2.fromOffset(20, 30)

		local nameLabel = label(clickBtn, item.label, 13, if isSelected then COLORS.text else COLORS.muted)
		nameLabel.Position = UDim2.fromOffset(24, 0)
		nameLabel.Size = UDim2.new(1, -90, 1, 0)
		nameLabel.TextTruncate = Enum.TextTruncate.AtEnd

		local badgeText = ""
		local badgeColor = COLORS.muted
		if isViewed then
			badgeText = "✓"
			badgeColor = COLORS.green
		elseif item.kind == "replaceScriptSource" then
			badgeText = `+{stats.added} −{stats.removed}`
			badgeColor = COLORS.diffAddText
		elseif item.kind == "setProperty" then
			badgeText = "M"
			badgeColor = COLORS.amber
		elseif item.kind == "createInstance" then
			badgeText = "A"
			badgeColor = COLORS.green
		end

		local badge = label(clickBtn, badgeText, 11, badgeColor)
		badge.Font = Enum.Font.RobotoMono
		badge.Position = UDim2.new(1, -70, 0, 0)
		badge.Size = UDim2.new(0, 66, 1, 0)
		badge.TextXAlignment = Enum.TextXAlignment.Right

		clickBtn.Activated:Connect(function()
			self.selectedItemKey = item.key
			self:renderExplorer()
			self:renderActiveItem()
			if item.operation then
				self.callbacks.onSelectTarget(item.operation)
			end
		end)
	end
end

function ReviewWidget:renderActiveItem()
	self.renderedLineCells = {}
	for _, child in self.editorScroll:GetChildren() do
		if not child:IsA("UIListLayout") then
			child:Destroy()
		end
	end

	local item = self:getCurrentItem()
	if not item or not self.selected then
		self.tabLabel.Text = "No item selected"
		self.rationaleText.Text = ""
		return
	end

	self.tabIcon.Text = item.icon
	self.tabLabel.Text = item.label
	local isViewed = self.viewed[item.key] == true
	self.viewedToggleBtn.Text = if isViewed then "✓ Viewed" else "○ Mark viewed"
	self.viewedToggleBtn.BackgroundColor3 = if isViewed then COLORS.green else COLORS.raised

	local record = self.selected
	local isSplit = self.diffViewMode == "split"

	if item.kind == "plan" then
		self.tabStatus.Text = "PLAN"
		self.tabStatus.TextColor3 = COLORS.accent
		self.rationaleText.Text = `Proposal: {record.proposal.title} — {record.proposal.summary}`

		local planContent = if record.proposal.plan then record.proposal.plan.content else ""
		local planLines = ReviewModel.splitLines(planContent)

		for index, lineText in planLines do
			local row = Instance.new("Frame")
			local baseColor = if index % 2 == 0 then COLORS.canvas else COLORS.sidebar
			row.BackgroundColor3 = baseColor
			row.BorderSizePixel = 0
			row.LayoutOrder = index
			row.Size = UDim2.new(1, 0, 0, 26)
			row.Parent = self.editorScroll

			table.insert(
				self.renderedLineCells,
				{ frame = row, side = "after", line = index, baseColor = baseColor }
			)

			-- Click & Drag on plan line
			row.InputBegan:Connect(function(input)
				if input.UserInputType == Enum.UserInputType.MouseButton1 then
					self.isDragging = true
					self.dragStartLine = index
					self.dragCurrentLine = index
					self.dragSide = "after"
					self.dragOpId = nil
					self.dragPath = "plan.md"
					self:updateDragHighlight()
				end
			end)

			row.MouseEnter:Connect(function()
				if self.isDragging and self.dragSide == "after" then
					self.dragCurrentLine = index
					self:updateDragHighlight()
				end
			end)

			local numLabel = label(row, string.format("%3d", index), 13, COLORS.muted)
			numLabel.Font = Enum.Font.RobotoMono
			numLabel.Position = UDim2.fromOffset(6, 0)
			numLabel.Size = UDim2.fromOffset(40, 26)
			numLabel.TextXAlignment = Enum.TextXAlignment.Right

			local codeLabel = label(row, "", 15, COLORS.text)
			codeLabel.Font = Enum.Font.RobotoMono
			codeLabel.Position = UDim2.fromOffset(54, 0)
			codeLabel.RichText = true
			codeLabel.Size = UDim2.new(1, -60, 1, 0)
			codeLabel.Text = ReviewModel.highlightMarkdown(lineText)

			-- Hover/Click comment trigger
			local addCommentBtn = button(row, "+", COLORS.raised)
			addCommentBtn.Position = UDim2.fromOffset(2, 3)
			addCommentBtn.Size = UDim2.fromOffset(20, 20)
			addCommentBtn.TextSize = 12
			addCommentBtn.Visible = false
			row.MouseEnter:Connect(function()
				addCommentBtn.Visible = true
			end)
			row.MouseLeave:Connect(function()
				addCommentBtn.Visible = false
			end)
			addCommentBtn.Activated:Connect(function()
				self:openCommentDialog("plan.md", index, index, "after", nil)
			end)

			-- Check for line comments
			local lineComments = self:getAnnotationsForLine(nil, index, "after")
			local cIdx = 1
			for _, comment in lineComments do
				self:renderInlineCommentCard(self.editorScroll, comment, (index * 10) + cIdx, "after")
				cIdx += 1
			end
		end
		return
	end

	-- Operation Diff Rendering
	local op = item.operation
	if not op then
		return
	end

	self.tabStatus.Text = if op.kind == "replaceScriptSource"
		then "M"
		elseif op.kind == "createInstance" then "A"
		else "C"
	self.tabStatus.TextColor3 = if op.kind == "createInstance" then COLORS.green else COLORS.amber
	self.rationaleText.Text = `Rationale: {op.rationale or "No rationale provided."}`

	local sources = ReviewModel.operationSources(op)
	local fullPath = ReviewModel.operationPath(op)

	if isSplit then
		-- Split Subheader
		local subHeader = Instance.new("Frame")
		subHeader.BackgroundColor3 = COLORS.surface
		subHeader.BorderSizePixel = 0
		subHeader.LayoutOrder = 0
		subHeader.Size = UDim2.new(1, 0, 0, 24)
		subHeader.Parent = self.editorScroll

		local leftHead = label(subHeader, "  BEFORE (ORIGINAL)", 11, COLORS.muted)
		leftHead.Font = Enum.Font.BuilderSansBold
		leftHead.Size = UDim2.new(0.5, -1, 1, 0)

		local divider = Instance.new("Frame")
		divider.BackgroundColor3 = COLORS.rule
		divider.BorderSizePixel = 0
		divider.Position = UDim2.new(0.5, -1, 0, 0)
		divider.Size = UDim2.new(0, 1, 1, 0)
		divider.Parent = subHeader

		local rightHead = label(subHeader, "  AFTER (PROPOSED)", 11, COLORS.muted)
		rightHead.Font = Enum.Font.BuilderSansBold
		rightHead.Position = UDim2.fromScale(0.5, 0)
		rightHead.Size = UDim2.fromScale(0.5, 1)

		local pairs = ReviewModel.alignedDiff(sources.before, sources.after)
		for index, pair in pairs do
			local lineRow = Instance.new("Frame")
			lineRow.BackgroundTransparency = 1
			lineRow.BorderSizePixel = 0
			lineRow.LayoutOrder = index * 10
			lineRow.Size = UDim2.new(1, 0, 0, 26)
			lineRow.Parent = self.editorScroll

			-- Left Cell (Before)
			local leftCell = Instance.new("Frame")
			leftCell.BorderSizePixel = 0
			leftCell.Position = UDim2.fromScale(0, 0)
			leftCell.Size = UDim2.new(0.5, -1, 1, 0)
			leftCell.Parent = lineRow

			if pair.before then
				local isRemoved = pair.before.kind == "removed"
				local baseColor = if isRemoved then COLORS.diffRemove else COLORS.canvas
				leftCell.BackgroundColor3 = baseColor

				table.insert(
					self.renderedLineCells,
					{ frame = leftCell, side = "before", line = pair.before.line, baseColor = baseColor }
				)

				leftCell.InputBegan:Connect(function(input)
					if input.UserInputType == Enum.UserInputType.MouseButton1 then
						self.isDragging = true
						self.dragStartLine = pair.before.line
						self.dragCurrentLine = pair.before.line
						self.dragSide = "before"
						self.dragOpId = op.id
						self.dragPath = fullPath
						self:updateDragHighlight()
					end
				end)

				leftCell.MouseEnter:Connect(function()
					if self.isDragging and self.dragSide == "before" then
						self.dragCurrentLine = pair.before.line
						self:updateDragHighlight()
					end
				end)

				local numLabel = label(
					leftCell,
					string.format("%3d -", pair.before.line),
					13,
					if isRemoved then COLORS.diffRemoveText else COLORS.muted
				)
				numLabel.Font = Enum.Font.RobotoMono
				numLabel.Size = UDim2.fromOffset(52, 26)
				numLabel.TextXAlignment = Enum.TextXAlignment.Right

				local codeLabel = label(leftCell, "", 15, COLORS.text)
				codeLabel.Font = Enum.Font.RobotoMono
				codeLabel.Position = UDim2.fromOffset(58, 0)
				codeLabel.RichText = true
				codeLabel.Size = UDim2.new(1, -60, 1, 0)
				codeLabel.Text = ReviewModel.highlightLuau(pair.before.text)

				local addBtn = button(leftCell, "+", COLORS.raised)
				addBtn.Position = UDim2.fromOffset(2, 3)
				addBtn.Size = UDim2.fromOffset(20, 20)
				addBtn.TextSize = 12
				addBtn.Visible = false
				leftCell.MouseEnter:Connect(function()
					addBtn.Visible = true
				end)
				leftCell.MouseLeave:Connect(function()
					addBtn.Visible = false
				end)
				addBtn.Activated:Connect(function()
					self:openCommentDialog(fullPath, pair.before.line, pair.before.line, "before", op.id)
				end)
			else
				leftCell.BackgroundColor3 = COLORS.subtle
			end

			-- Divider
			local splitDivider = Instance.new("Frame")
			splitDivider.BackgroundColor3 = COLORS.rule
			splitDivider.BorderSizePixel = 0
			splitDivider.Position = UDim2.new(0.5, -1, 0, 0)
			splitDivider.Size = UDim2.new(0, 1, 1, 0)
			splitDivider.Parent = lineRow

			-- Right Cell (After)
			local rightCell = Instance.new("Frame")
			rightCell.BorderSizePixel = 0
			rightCell.Position = UDim2.fromScale(0.5, 0)
			rightCell.Size = UDim2.fromScale(0.5, 1)
			rightCell.Parent = lineRow

			if pair.after then
				local isAdded = pair.after.kind == "added"
				local baseColor = if isAdded then COLORS.diffAdd else COLORS.canvas
				rightCell.BackgroundColor3 = baseColor

				table.insert(
					self.renderedLineCells,
					{ frame = rightCell, side = "after", line = pair.after.line, baseColor = baseColor }
				)

				rightCell.InputBegan:Connect(function(input)
					if input.UserInputType == Enum.UserInputType.MouseButton1 then
						self.isDragging = true
						self.dragStartLine = pair.after.line
						self.dragCurrentLine = pair.after.line
						self.dragSide = "after"
						self.dragOpId = op.id
						self.dragPath = fullPath
						self:updateDragHighlight()
					end
				end)

				rightCell.MouseEnter:Connect(function()
					if self.isDragging and self.dragSide == "after" then
						self.dragCurrentLine = pair.after.line
						self:updateDragHighlight()
					end
				end)

				local numLabel = label(
					rightCell,
					string.format("%3d +", pair.after.line),
					13,
					if isAdded then COLORS.diffAddText else COLORS.muted
				)
				numLabel.Font = Enum.Font.RobotoMono
				numLabel.Size = UDim2.fromOffset(52, 26)
				numLabel.TextXAlignment = Enum.TextXAlignment.Right

				local codeLabel = label(rightCell, "", 15, COLORS.text)
				codeLabel.Font = Enum.Font.RobotoMono
				codeLabel.Position = UDim2.fromOffset(58, 0)
				codeLabel.RichText = true
				codeLabel.Size = UDim2.new(1, -60, 1, 0)
				codeLabel.Text = ReviewModel.highlightLuau(pair.after.text)

				local addBtn = button(rightCell, "+", COLORS.raised)
				addBtn.Position = UDim2.fromOffset(2, 3)
				addBtn.Size = UDim2.fromOffset(20, 20)
				addBtn.TextSize = 12
				addBtn.Visible = false
				rightCell.MouseEnter:Connect(function()
					addBtn.Visible = true
				end)
				rightCell.MouseLeave:Connect(function()
					addBtn.Visible = false
				end)
				addBtn.Activated:Connect(function()
					self:openCommentDialog(fullPath, pair.after.line, pair.after.line, "after", op.id)
				end)
			else
				rightCell.BackgroundColor3 = COLORS.subtle
			end

			-- Render inline comment cards if any exist
			local lineBefore = if pair.before then pair.before.line else nil
			local lineAfter = if pair.after then pair.after.line else nil
			local comments = {}
			if lineBefore then
				for _, c in self:getAnnotationsForLine(op.id, lineBefore, "before") do
					table.insert(comments, c)
				end
			end
			if lineAfter then
				for _, c in self:getAnnotationsForLine(op.id, lineAfter, "after") do
					table.insert(comments, c)
				end
			end
			local cIndex = 1
			for _, c in comments do
				self:renderInlineCommentCard(self.editorScroll, c, (index * 10) + cIndex, c.side)
				cIndex += 1
			end
		end
	else
		-- Unified Mode
		local diffTokens =
			ReviewModel.diffLines(table.concat(sources.before, "\n"), table.concat(sources.after, "\n"))
		for index, token in diffTokens do
			local lineRow = Instance.new("Frame")
			lineRow.BorderSizePixel = 0
			lineRow.LayoutOrder = index * 10
			lineRow.Size = UDim2.new(1, 0, 0, 26)

			local prefix = " "
			local textColor = COLORS.text
			local baseColor = COLORS.canvas

			if token.kind == "added" then
				prefix = "+"
				textColor = COLORS.diffAddText
				baseColor = COLORS.diffAdd
			elseif token.kind == "removed" then
				prefix = "-"
				textColor = COLORS.diffRemoveText
				baseColor = COLORS.diffRemove
			end
			lineRow.BackgroundColor3 = baseColor

			local lineNum = token.newLine or token.oldLine or index
			local sideName = if token.kind == "removed" then "before" else "after"

			table.insert(
				self.renderedLineCells,
				{ frame = lineRow, side = sideName, line = lineNum, baseColor = baseColor }
			)

			lineRow.InputBegan:Connect(function(input)
				if input.UserInputType == Enum.UserInputType.MouseButton1 then
					self.isDragging = true
					self.dragStartLine = lineNum
					self.dragCurrentLine = lineNum
					self.dragSide = sideName
					self.dragOpId = op.id
					self.dragPath = fullPath
					self:updateDragHighlight()
				end
			end)

			lineRow.MouseEnter:Connect(function()
				if self.isDragging and self.dragSide == sideName then
					self.dragCurrentLine = lineNum
					self:updateDragHighlight()
				end
			end)

			local oldNoStr = if token.oldLine then tostring(token.oldLine) else ""
			local newNoStr = if token.newLine then tostring(token.newLine) else ""
			local numLabel = label(lineRow, string.format("%3s %3s", oldNoStr, newNoStr), 13, COLORS.muted)
			numLabel.Font = Enum.Font.RobotoMono
			numLabel.Size = UDim2.fromOffset(68, 26)
			numLabel.TextXAlignment = Enum.TextXAlignment.Right

			local prefixLabel = label(lineRow, ` {prefix} `, 14, textColor)
			prefixLabel.Font = Enum.Font.RobotoMono
			prefixLabel.Position = UDim2.fromOffset(70, 0)
			prefixLabel.Size = UDim2.fromOffset(20, 26)

			local codeLabel = label(lineRow, "", 15, textColor)
			codeLabel.Font = Enum.Font.RobotoMono
			codeLabel.Position = UDim2.fromOffset(94, 0)
			codeLabel.RichText = true
			codeLabel.Size = UDim2.new(1, -98, 1, 0)
			codeLabel.Text = ReviewModel.highlightLuau(token.text)

			local addBtn = button(lineRow, "+", COLORS.raised)
			addBtn.Position = UDim2.fromOffset(2, 3)
			addBtn.Size = UDim2.fromOffset(20, 20)
			addBtn.TextSize = 12
			addBtn.Visible = false
			lineRow.MouseEnter:Connect(function()
				addBtn.Visible = true
			end)
			lineRow.MouseLeave:Connect(function()
				addBtn.Visible = false
			end)
			addBtn.Activated:Connect(function()
				self:openCommentDialog(fullPath, lineNum, lineNum, sideName, op.id)
			end)

			lineRow.Parent = self.editorScroll

			local cIndex = 1
			for _, c in self:getAnnotationsForLine(op.id, lineNum, sideName) do
				self:renderInlineCommentCard(self.editorScroll, c, (index * 10) + cIndex, sideName)
				cIndex += 1
			end
		end
	end
end

function ReviewWidget:updateActionState()
	local record = self.selected
	if not self.connected or not record then
		setButtonEnabled(self.approveBtn, false, COLORS.raised)
		setButtonEnabled(self.reqChangesBtn, false, COLORS.raised)
		setButtonEnabled(self.rejectBtn, false, COLORS.raised)
		return
	end

	local status = record.status
	if status == "APPROVED" then
		self.approveBtn.Text = "⚡ Apply Changes"
		setButtonEnabled(self.approveBtn, true, COLORS.green)
		setButtonEnabled(self.reqChangesBtn, false, COLORS.raised)
		setButtonEnabled(self.rejectBtn, false, COLORS.raised)
		self:setStatus("🎉 Proposal approved! Click 'Apply Changes' to write to Studio DataModel.", true)
	elseif status == "READY_FOR_REVIEW" then
		self.approveBtn.Text = "Approve"
		setButtonEnabled(self.approveBtn, true, COLORS.green)
		setButtonEnabled(self.reqChangesBtn, true, COLORS.amber)
		setButtonEnabled(self.rejectBtn, true, COLORS.red)
		self:setStatus(`Ready for review (Rev {record.proposal.revision})`, true)
	elseif status == "CHANGES_REQUESTED" then
		self.approveBtn.Text = "Approve"
		setButtonEnabled(self.approveBtn, false, COLORS.raised)
		setButtonEnabled(self.reqChangesBtn, false, COLORS.raised)
		setButtonEnabled(self.rejectBtn, false, COLORS.raised)
		self:setStatus(
			`⏳ Feedback sent for Rev {record.proposal.revision}. Waiting for AI agent to submit new revision...`,
			false
		)
	elseif status == "CONFLICTED" then
		self.approveBtn.Text = "Approve"
		setButtonEnabled(self.approveBtn, false, COLORS.raised)
		setButtonEnabled(self.reqChangesBtn, true, COLORS.amber)
		setButtonEnabled(self.rejectBtn, true, COLORS.red)
		local preflightErr = if record.preflight
				and record.preflight.errors
				and #record.preflight.errors > 0
			then table.concat(record.preflight.errors, "; ")
			else "Studio DataModel conflict detected"
		self:setStatus(`⚠️ Preflight Conflict: {preflightErr}`, false)
	else
		self.approveBtn.Text = "Approve"
		setButtonEnabled(self.approveBtn, false, COLORS.raised)
		setButtonEnabled(self.reqChangesBtn, false, COLORS.raised)
		setButtonEnabled(self.rejectBtn, false, COLORS.raised)
	end
end

function ReviewWidget:render(records: { any })
	self.records = records

	local prevProposalId = if self.selected then self.selected.proposal.proposalId else nil
	local selected = nil

	-- 1. If we are tracking a proposal ID, select its highest revision
	if prevProposalId then
		local bestRev = -1
		for _, candidate in records do
			if candidate.proposal.proposalId == prevProposalId then
				local rev = candidate.proposal.revision or 1
				if rev > bestRev then
					bestRev = rev
					selected = candidate
				end
			end
		end
	end

	-- 2. If no prior selection, find the highest actionable proposal
	if not selected then
		local bestCandidate = nil
		for _, candidate in records do
			if
				candidate.status == "READY_FOR_REVIEW"
				or candidate.status == "APPROVED"
				or candidate.status == "PREFLIGHT"
				or candidate.status == "APPLYING"
			then
				if not bestCandidate or (candidate.proposal.revision > bestCandidate.proposal.revision) then
					bestCandidate = candidate
				end
			end
		end
		selected = bestCandidate
	end

	-- 3. Fallback to newest record
	if not selected and #records > 0 then
		selected = records[#records]
	end

	self.selected = selected

	if not self.selected then
		self.breadcrumb.Text = "Waiting for proposal..."
		self:renderExplorer()
		self:renderActiveItem()
		self:updateActionState()
		return
	end

	local record = self.selected
	local maxRev = record.proposal.revision or 1
	for _, cand in records do
		if cand.proposal.proposalId == record.proposal.proposalId and cand.proposal.revision > maxRev then
			maxRev = cand.proposal.revision
		end
	end

	local statusBadge = if record.status == "APPROVED"
		then "● APPROVED"
		elseif record.status == "CHANGES_REQUESTED" then "⏳ FEEDBACK SENT"
		elseif record.status == "READY_FOR_REVIEW" then "● READY"
		else record.status

	self.breadcrumb.Text =
		`{record.proposal.title} [Rev {record.proposal.revision}/{maxRev} · {statusBadge}]`
	if self.propSelectBtn then
		self.propSelectBtn.Text = `📁 {record.proposal.title} (r{record.proposal.revision}) ▼`
	end
	self:renderExplorer()
	self:renderActiveItem()
	self:updateActionState()
end

return ReviewWidget
