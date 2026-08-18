const state = {
  records: [],
  record: null,
  items: [],
  selectedKey: null,
  view: "split",
  planStyle: localStorage.getItem("roview-plan-style") || "grid",
  annotations: [],
  anchor: null,
  selectedRange: null,
  viewed: new Set(),
  token: "",
  draftGeneration: 0,
  draftTimer: null,
  draftIdentity: "",
  cursor: 0,
};


const $ = (selector) => document.querySelector(selector);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Luau / Roblox Studio & Markdown Syntax Highlighting Engine
function highlightLuau(rawText) {
  if (!rawText) return " ";
  
  const pattern = /(--\[\[[\s\S]*?\]\]|--.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\[\[[\s\S]*?\]\])|(\b(?:0x[0-9a-fA-F_]+|0b[01_]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b)|(\b(?:local|function|end|if|then|else|elseif|return|for|in|do|while|repeat|until|and|or|not|export|type|continue|break)\b)|(\b(?:game|workspace|script|math|table|string|task|coroutine|Instance|Vector3|CFrame|Color3|UDim2|UDim|Enum|RaycastParams|TweenInfo|BrickColor|DateTime|warn|print|error|typeof|assert|require|pcall|xpcall|setmetatable|getmetatable|select|pairs|ipairs|next|tostring|tonumber)\b)|(\b(?:true|false|nil)\b)|(\bself\b)|(:[a-zA-Z_][a-zA-Z0-9_]*)|(==|~=|<=|>=|\.\.|\:\:|->|\+=|-=|\*=|\/=|[\+\-\*\/%^#=<>])/g;

  let lastIndex = 0;
  let html = "";
  let match;

  while ((match = pattern.exec(rawText)) !== null) {
    if (match.index > lastIndex) {
      html += escapeHtml(rawText.slice(lastIndex, match.index));
    }
    
    if (match[1]) { // Comment
      html += `<span class="tok-comm">${escapeHtml(match[1])}</span>`;
    } else if (match[2]) { // String
      html += `<span class="tok-str">${escapeHtml(match[2])}</span>`;
    } else if (match[3]) { // Number
      html += `<span class="tok-num">${escapeHtml(match[3])}</span>`;
    } else if (match[4]) { // Keyword
      html += `<span class="tok-kw">${escapeHtml(match[4])}</span>`;
    } else if (match[5]) { // Builtin
      html += `<span class="tok-builtin">${escapeHtml(match[5])}</span>`;
    } else if (match[6]) { // Boolean / Nil
      html += `<span class="tok-bool">${escapeHtml(match[6])}</span>`;
    } else if (match[7]) { // Self
      html += `<span class="tok-self">${escapeHtml(match[7])}</span>`;
    } else if (match[8]) { // Method
      html += `<span class="tok-method">${escapeHtml(match[8])}</span>`;
    } else if (match[9]) { // Operator
      html += `<span class="tok-op">${escapeHtml(match[9])}</span>`;
    }
    
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < rawText.length) {
    html += escapeHtml(rawText.slice(lastIndex));
  }

  return html || " ";
}

function highlightMarkdown(rawText) {
  if (!rawText) return " ";
  let text = escapeHtml(rawText);
  if (/^#+\s/.test(rawText)) {
    return `<span class="tok-md-h">${text}</span>`;
  }
  if (/^[\*\-\+]\s/.test(rawText) || /^\d+\.\s/.test(rawText)) {
    text = text.replace(/^([\*\-\+]|\d+\.)(\s)/, '<span class="tok-md-list">$1</span>$2');
  }
  text = text.replace(/`([^`]+)`/g, '<span class="tok-md-code">$1</span>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<span class="tok-md-bold">$1</span>');
  text = text.replace(/\*([^*]+)\*/g, '<span class="tok-md-italic">$1</span>');
  return text;
}

function getItemLanguage(item) {
  if (!item) return "Luau";
  if (item.kind === "plan") return "Markdown";
  if (item.kind === "setProperty") return "Luau Property";
  if (item.kind === "createInstance") return "Instance Def";
  if (item.kind === "createScript") return "Luau";
  if (item.kind === "deleteInstance") return "Instance Deletion";
  if (item.kind === "reparentInstance") return "Instance Reparent";
  const path = operationPath(item.operation);
  if (path.endsWith(".json")) return "JSON";
  if (path.endsWith(".toml")) return "TOML";
  return "Luau";
}

function getItemStudioIcon(item) {
  if (!item) return { icon: "📜", className: "script-server", label: "Script" };
  if (item.kind === "plan") return { icon: "📄", className: "file-plan", label: "Plan" };
  if (item.kind === "createInstance") return { icon: "📦", className: "file-instance", label: "Instance" };
  if (item.kind === "deleteInstance") return { icon: "🗑️", className: "file-delete", label: "Delete" };
  if (item.kind === "reparentInstance") return { icon: "↪️", className: "file-reparent", label: "Reparent" };
  if (item.kind === "createScript") {
    if (item.operation.target.className === "LocalScript") return { icon: "⚡", className: "script-client", label: "Local Script" };
    if (item.operation.target.className === "ModuleScript") return { icon: "🔷", className: "script-module", label: "Module Script" };
    return { icon: "📜", className: "script-server", label: "Server Script" };
  }
  const path = operationPath(item.operation).toLowerCase();
  if (path.includes(".server.") || path.includes("init.server.")) {
    return { icon: "📜", className: "script-server", label: "Server Script" };
  }
  if (path.includes(".client.") || path.includes("init.client.")) {
    return { icon: "⚡", className: "script-client", label: "Local Script" };
  }
  if (path.endsWith(".luau") || path.endsWith(".lua") || path.includes("init.")) {
    return { icon: "🔷", className: "script-module", label: "Module Script" };
  }
  if (path.endsWith(".json") || path.endsWith(".toml")) {
    return { icon: "⚙️", className: "file-config", label: "Config" };
  }
  return { icon: "📜", className: "script-server", label: "Script" };
}


function readToken() {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl) {
    sessionStorage.setItem("roview-token", fromUrl);
    url.searchParams.delete("token");
    history.replaceState({}, "", url);
  }
  return fromUrl || sessionStorage.getItem("roview-token") || "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Roview request failed");
  return body;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("visible");
  window.setTimeout(() => node.classList.remove("visible"), 2200);
}

function recordIdentity(record = state.record) {
  return record ? `${record.proposal.proposalId}:${record.proposal.revision}:${record.digest}` : "";
}

function updateFeedbackPreview() {
  if (!state.record) return;
  $("#feedback-preview").textContent = JSON.stringify({
    proposalId: state.record.proposal.proposalId,
    revision: state.record.proposal.revision,
    proposalDigest: state.record.digest,
    comments: collectComments(),
  }, null, 2);
}

async function saveDraftNow() {
  if (!state.record || state.record.decision || state.record.status !== "READY_FOR_REVIEW") return;
  const identity = recordIdentity();
  const { proposal } = state.record;
  try {
    const result = await api(`/v1/proposals/${encodeURIComponent(proposal.proposalId)}/${proposal.revision}/draft`, {
      method: "PUT",
      body: JSON.stringify({
        proposalDigest: state.record.digest,
        expectedGeneration: state.draftGeneration,
        comments: state.annotations,
        globalComment: $("#general-comment").value,
        viewedItemIds: [...state.viewed],
      }),
    });
    if (recordIdentity() === identity) state.draftGeneration = result.draft.generation;
  } catch (error) {
    toast(error.message);
  }
}

function scheduleDraftSave() {
  updateFeedbackPreview();
  window.clearTimeout(state.draftTimer);
  state.draftTimer = window.setTimeout(saveDraftNow, 350);
}

async function restoreDraft(record) {
  const identity = recordIdentity(record);
  try {
    const result = await api(`/v1/proposals/${encodeURIComponent(record.proposal.proposalId)}/${record.proposal.revision}/draft`);
    if (recordIdentity() !== identity) return;
    const draft = result.draft;
    state.draftGeneration = draft?.generation || 0;
    if (draft) {
      state.annotations = draft.comments;
      state.viewed = new Set(draft.viewedItemIds);
      $("#general-comment").value = draft.globalComment;
      renderAnnotations();
      renderChange();
    }
    updateFeedbackPreview();
  } catch (error) {
    toast(`Draft could not be restored: ${error.message}`);
  }
}

function operationPath(operation) {
  if (operation.kind === "createInstance" || operation.kind === "createScript") {
    return [...operation.target.parent.path, operation.target.name].join("/");
  }
  return operation.target.path.join("/");
}

function operationGroup(operation) {
  if (operation.kind === "createInstance" || operation.kind === "createScript") {
    return operation.target.parent.path[0] || "DataModel";
  }
  return operation.target.path[0] || "DataModel";
}

function valueText(value) {
  switch (value.type) {
    case "string": return JSON.stringify(value.value);
    case "number":
    case "boolean": return String(value.value);
    case "Color3": return `Color3.new(${value.r}, ${value.g}, ${value.b})`;
    case "Vector3": return `Vector3.new(${value.x}, ${value.y}, ${value.z})`;
    case "Enum": return `Enum.${value.enum}.${value.item}`;
    default: return JSON.stringify(value);
  }
}

function lines(value) {
  return value.replace(/\n$/, "").split("\n");
}

function rawDiff(beforeLines, afterLines) {
  const product = beforeLines.length * afterLines.length;
  if (product > 250_000) {
    const pairs = [];
    const length = Math.max(beforeLines.length, afterLines.length);
    for (let index = 0; index < length; index += 1) {
      const before = beforeLines[index];
      const after = afterLines[index];
      if (before === after && before !== undefined) pairs.push({ kind: "context", text: before });
      else {
        if (before !== undefined) pairs.push({ kind: "removed", text: before });
        if (after !== undefined) pairs.push({ kind: "added", text: after });
      }
    }
    return pairs;
  }
  const matrix = Array.from({ length: beforeLines.length + 1 }, () => new Array(afterLines.length + 1).fill(0));
  for (let bIndex = 0; bIndex < beforeLines.length; bIndex += 1) {
    for (let aIndex = 0; aIndex < afterLines.length; aIndex += 1) {
      if (beforeLines[bIndex] === afterLines[aIndex]) matrix[bIndex + 1][aIndex + 1] = matrix[bIndex][aIndex] + 1;
      else matrix[bIndex + 1][aIndex + 1] = Math.max(matrix[bIndex + 1][aIndex], matrix[bIndex][aIndex + 1]);
    }
  }
  const result = [];
  let bIndex = beforeLines.length;
  let aIndex = afterLines.length;
  while (bIndex > 0 || aIndex > 0) {
    if (bIndex > 0 && aIndex > 0 && beforeLines[bIndex - 1] === afterLines[aIndex - 1]) {
      result.unshift({ kind: "context", text: beforeLines[bIndex - 1] });
      bIndex -= 1;
      aIndex -= 1;
    } else if (aIndex > 0 && (bIndex === 0 || matrix[bIndex][aIndex - 1] >= matrix[bIndex - 1][aIndex])) {
      result.unshift({ kind: "added", text: afterLines[aIndex - 1] });
      aIndex -= 1;
    } else if (bIndex > 0) {
      result.unshift({ kind: "removed", text: beforeLines[bIndex - 1] });
      bIndex -= 1;
    }
  }
  return result;
}

function alignedDiff(beforeLines, afterLines) {
  const raw = rawDiff(beforeLines, afterLines);
  const pairs = [];
  let oldLine = 1;
  let newLine = 1;
  let index = 0;
  while (index < raw.length) {
    if (raw[index].kind === "context") {
      pairs.push({
        before: { line: oldLine, text: raw[index].text, type: "context" },
        after: { line: newLine, text: raw[index].text, type: "context" },
      });
      oldLine += 1;
      newLine += 1;
      index += 1;
      continue;
    }
    const removed = [];
    const added = [];
    while (index < raw.length && raw[index].kind !== "context") {
      if (raw[index].kind === "removed") removed.push({ line: oldLine++, text: raw[index].text, type: "removed" });
      else added.push({ line: newLine++, text: raw[index].text, type: "added" });
      index += 1;
    }
    const changedLength = Math.max(removed.length, added.length);
    for (let changedIndex = 0; changedIndex < changedLength; changedIndex += 1) {
      pairs.push({ before: removed[changedIndex] || null, after: added[changedIndex] || null });
    }
  }
  return pairs;
}

function operationSources(operation) {
  if (operation.kind === "replaceScriptSource") {
    return {
      before: lines(operation.before.source || "-- Source body was not supplied; hash-only precondition"),
      after: lines(operation.after.source),
    };
  }
  if (operation.kind === "createScript") {
    return {
      before: [],
      after: lines(operation.after.source),
    };
  }
  if (operation.kind === "setProperty") {
    return {
      before: [`${operation.property} = ${valueText(operation.before)}`],
      after: [`${operation.property} = ${valueText(operation.after)}`],
    };
  }
  if (operation.kind === "deleteInstance") {
    return {
      before: [
        `Target: ${operation.target.path.join("/")}`,
        ...(operation.preconditions.className ? [`Expected Class: ${operation.preconditions.className}`] : []),
        ...(operation.preconditions.maxChildren !== undefined ? [`Max Children: ${operation.preconditions.maxChildren}`] : []),
      ],
      after: ["-- Instance deleted"],
    };
  }
  if (operation.kind === "reparentInstance") {
    const oldParent = operation.target.path.slice(0, -1).join("/");
    const oldName = operation.target.path.at(-1) || "";
    const newParent = operation.after.parent ? operation.after.parent.path.join("/") : oldParent;
    const newName = operation.after.name || oldName;
    return {
      before: [
        `Parent: ${oldParent}`,
        `Name: ${oldName}`,
      ],
      after: [
        `Parent: ${newParent}`,
        `Name: ${newName}`,
      ],
    };
  }
  return {
    before: [],
    after: [
      `ClassName = ${operation.target.className}`,
      `Name = ${JSON.stringify(operation.target.name)}`,
      `Parent = ${operation.target.parent.path.join("/")}`,
    ],
  };
}


function statsForItem(item) {
  if (item.kind === "plan") return { added: lines(state.record.proposal.plan.content).length, removed: 0 };
  const { before, after } = operationSources(item.operation);
  const tokens = rawDiff(before, after);
  return {
    added: tokens.filter((token) => token.kind === "added").length,
    removed: tokens.filter((token) => token.kind === "removed").length,
  };
}

function createItems(record) {
  const plan = { key: "plan", kind: "plan", group: "Proposal", label: "plan.md" };
  return [plan, ...record.proposal.operations.map((operation) => ({
    key: operation.id,
    kind: operation.kind,
    group: operationGroup(operation),
    label: operationPath(operation).split("/").at(-1),
    operation,
  }))];
}

function currentItem() {
  return state.items.find((item) => item.key === state.selectedKey) || null;
}

function isAnnotated(operationId, line, side) {
  return state.annotations.some((annotation) => {
    const opMatch = annotation.operationId === operationId || (!annotation.operationId && !operationId);
    const sideMatch = !annotation.side || annotation.side === side;
    const start = annotation.lineStart || annotation.line;
    const end = annotation.lineEnd || annotation.line;
    return opMatch && sideMatch && line >= start && line <= end;
  });
}

function getAnnotationsForLine(operationId, line, side) {
  return state.annotations.filter((annotation) => {
    const opMatch = annotation.operationId === operationId || (!annotation.operationId && !operationId);
    const sideMatch = !annotation.side || annotation.side === side;
    const end = annotation.lineEnd || annotation.line;
    return opMatch && sideMatch && line === end;
  });
}

function openInlinePopover(range, targetElement) {
  state.selectedRange = range;
  const popover = $("#inline-comment-popover");
  const diffPane = $("#diff-pane-container");
  
  const lineLabel = range.lineStart === range.lineEnd
    ? `Line ${range.lineStart}`
    : `Lines ${range.lineStart}–${range.lineEnd}`;
  $("#inline-popover-header").textContent = `${range.path} · ${range.side ? range.side + " " : ""}${lineLabel}`;
  $("#inline-comment-body").value = "";
  
  if (targetElement) {
    const paneRect = diffPane.getBoundingClientRect();
    const elemRect = targetElement.getBoundingClientRect();
    let top = elemRect.bottom - paneRect.top + diffPane.scrollTop + 6;
    let left = Math.max(12, elemRect.left - paneRect.left);
    if (left + 450 > paneRect.width) left = Math.max(12, paneRect.width - 460);
    
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }
  popover.hidden = false;
  $("#inline-comment-body").focus();
}

function closeInlinePopover() {
  state.selectedRange = null;
  $("#inline-comment-popover").hidden = true;
}

function renderInlineCommentsRow(annotations, colSpan = 2) {
  const tr = element("tr", "inline-comment-row");
  const td = element("td", "");
  td.colSpan = colSpan;
  
  for (const annotation of annotations) {
    const box = element("div", "inline-comment-box");
    const lineLabel = (annotation.lineStart && annotation.lineStart !== annotation.lineEnd)
      ? `Lines ${annotation.lineStart}–${annotation.lineEnd}`
      : `Line ${annotation.lineEnd || annotation.line}`;
    
    const header = element("div", "inline-comment-header");
    header.append(
      element("span", "", `${annotation.side ? annotation.side.toUpperCase() + " · " : ""}${lineLabel}`),
    );
    
    const body = element("p", "inline-comment-body", annotation.body);
    
    // Check if the comment has a code suggestion block
    const suggestionMatch = /```suggestion\n([\s\S]*?)\n```/.exec(annotation.body);
    let suggestionBox = null;
    if (suggestionMatch) {
      suggestionBox = element("div", "inline-comment-suggestion");
      const sugHeader = element("div", "inline-comment-suggestion-header", "Suggested Change");
      const sugCode = element("pre", "line-code");
      sugCode.innerHTML = highlightLuau(suggestionMatch[1]);
      suggestionBox.append(sugHeader, sugCode);
    }
    
    const actions = element("div", "inline-comment-actions");
    const delBtn = element("button", "", "× Delete comment");
    delBtn.addEventListener("click", () => {
      const index = state.annotations.indexOf(annotation);
      if (index >= 0) {
        state.annotations.splice(index, 1);
        renderAnnotations();
        renderChange();
        scheduleDraftSave();
      }
    });
    actions.append(delBtn);
    
    box.append(header, body);
    if (suggestionBox) box.append(suggestionBox);
    box.append(actions);
    td.append(box);
  }
  tr.append(td);
  return tr;
}

function lineCell(line, side, operationId, path) {
  const cell = element("td", "diff-cell");
  if (!line) {
    cell.append(element("div", "line-wrap empty"));
    return cell;
  }
  const annotated = isAnnotated(operationId, line.line, side);
  const wrap = element("div", `line-wrap ${line.type}${annotated ? " annotated" : ""}`);
  wrap.setAttribute("data-line", String(line.line));
  wrap.setAttribute("data-side", side);
  
  const codeSpan = element("span", "line-code");
  codeSpan.innerHTML = highlightLuau(line.text);
  
  wrap.append(
    element("span", "line-number", String(line.line)),
    element("span", "line-prefix", line.type === "added" ? "+" : line.type === "removed" ? "−" : ""),
    codeSpan,
  );
  
  const add = element("button", "add-line-comment", "+");
  add.setAttribute("aria-label", `Comment on ${side} line ${line.line}`);
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    openInlinePopover({
      operationId,
      lineStart: line.line,
      lineEnd: line.line,
      side,
      path,
    }, wrap);
  });
  cell.append(wrap, add);
  return cell;
}

function renderSplitDiff(item, pairs) {
  const table = element("table", "diff-table");
  const body = document.createElement("tbody");
  const path = operationPath(item.operation);
  
  for (const pair of pairs) {
    const row = document.createElement("tr");
    row.append(
      lineCell(pair.before, "before", item.operation.id, path),
      lineCell(pair.after, "after", item.operation.id, path),
    );
    body.append(row);

    const lineNumBefore = pair.before?.line;
    const lineNumAfter = pair.after?.line;
    const comments = [
      ...(lineNumBefore ? getAnnotationsForLine(item.operation.id, lineNumBefore, "before") : []),
      ...(lineNumAfter ? getAnnotationsForLine(item.operation.id, lineNumAfter, "after") : []),
    ];
    
    if (comments.length > 0) {
      body.append(renderInlineCommentsRow(comments, 2));
    }
  }
  table.append(body);
  return table;
}

function renderUnifiedLine(line, side, operationId, path) {
  const annotated = isAnnotated(operationId, line.line, side);
  const row = element("div", `unified-line line-wrap ${line.type}${annotated ? " annotated" : ""}`);
  row.setAttribute("data-line", String(line.line));
  row.setAttribute("data-side", side);
  
  const codeSpan = element("span", "line-code");
  codeSpan.innerHTML = highlightLuau(line.text);
  
  row.append(
    element("span", "line-number", side === "before" ? String(line.line) : ""),
    element("span", "line-number", side === "after" ? String(line.line) : ""),
    element("span", "line-prefix", line.type === "added" ? "+" : line.type === "removed" ? "−" : ""),
    codeSpan,
  );
  const add = element("button", "add-line-comment", "+");
  add.setAttribute("aria-label", `Comment on ${side} line ${line.line}`);
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    openInlinePopover({
      operationId,
      lineStart: line.line,
      lineEnd: line.line,
      side,
      path,
    }, row);
  });
  row.append(add);
  return row;
}

function renderUnifiedDiff(item, pairs) {
  const fragment = document.createDocumentFragment();
  const path = operationPath(item.operation);
  for (const pair of pairs) {
    let lineObj = null;
    let sideName = "after";
    if (pair.before?.type === "context") {
      lineObj = pair.after;
      sideName = "after";
      fragment.append(renderUnifiedLine(pair.after, "after", item.operation.id, path));
    } else {
      if (pair.before) {
        lineObj = pair.before;
        sideName = "before";
        fragment.append(renderUnifiedLine(pair.before, "before", item.operation.id, path));
      }
      if (pair.after) {
        lineObj = pair.after;
        sideName = "after";
        fragment.append(renderUnifiedLine(pair.after, "after", item.operation.id, path));
      }
    }
    
    if (lineObj) {
      const comments = getAnnotationsForLine(item.operation.id, lineObj.line, sideName);
      if (comments.length > 0) {
        const wrapContainer = element("div", "inline-comment-wrapper");
        const table = element("table", "diff-table");
        table.append(renderInlineCommentsRow(comments, 1));
        wrapContainer.append(table);
        fragment.append(wrapContainer);
      }
    }
  }
  return fragment;
}

function renderPlan(item) {
  const container = element("div", state.planStyle === "grid" ? "plan-review plan-view-grid" : "plan-review plan-view-clean");
  const innerCard = element("div", state.planStyle === "grid" ? "plan-review-card" : "");
  
  lines(state.record.proposal.plan.content).forEach((text, index) => {
    const lineNumber = index + 1;
    const row = element("div", `plan-line${isAnnotated(undefined, lineNumber, "after") ? " annotated" : ""}`);
    row.setAttribute("data-line", String(lineNumber));
    row.setAttribute("data-side", "after");
    
    const codeSpan = element("span", "line-code");
    codeSpan.innerHTML = highlightMarkdown(text);
    
    row.append(
      element("span", "line-number", String(lineNumber)),
      element("span", "line-prefix", ""),
      codeSpan
    );
    
    const add = element("button", "add-line-comment", "+");
    add.setAttribute("aria-label", `Comment on plan line ${lineNumber}`);
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      openInlinePopover({
        operationId: undefined,
        lineStart: lineNumber,
        lineEnd: lineNumber,
        side: "after",
        path: item.label,
      }, row);
    });
    row.append(add);
    
    (state.planStyle === "grid" ? innerCard : container).append(row);

    const comments = getAnnotationsForLine(undefined, lineNumber, "after");
    if (comments.length > 0) {
      const wrapContainer = element("div", "inline-comment-wrapper");
      const table = element("table", "diff-table");
      table.append(renderInlineCommentsRow(comments, 1));
      wrapContainer.append(table);
      (state.planStyle === "grid" ? innerCard : container).append(wrapContainer);
    }
  });

  if (state.planStyle === "grid") container.append(innerCard);
  return container;
}

function renderChange() {
  const item = currentItem();
  if (!item) return;
  closeInlinePopover();
  const stats = statsForItem(item);
  const path = item.kind === "plan" ? "plan.md" : operationPath(item.operation);
  const studioIcon = getItemStudioIcon(item);
  const lang = getItemLanguage(item);
  
  // Update Tab Bar
  $("#active-tab-icon").textContent = studioIcon.icon;
  $("#active-tab-label").textContent = item.label;
  $("#active-tab-status").textContent = (item.kind === "createInstance" || item.kind === "createScript") ? "A" : item.kind === "deleteInstance" ? "D" : item.kind === "reparentInstance" ? "R" : item.kind === "plan" ? "P" : "M";
  
  // Update Status Bar
  $("#status-lang").textContent = lang;
  $("#status-selection-info").textContent = `File ${state.items.indexOf(item) + 1} of ${state.items.length}`;
  
  $("#change-kind").textContent = item.kind === "plan" ? "Proposal plan" : item.kind;
  $("#change-path").textContent = path;
  $("#change-stats").textContent = `+${stats.added} −${stats.removed}`;
  $("#viewed-toggle").textContent = state.viewed.has(item.key) ? "✓ Viewed" : "○ Mark viewed";
  $("#context-bar").replaceChildren();
  const contextStrong = element("strong", "", item.kind === "plan" ? state.record.proposal.title : "Rationale: ");
  $("#context-bar").append(contextStrong, document.createTextNode(item.kind === "plan" ? ` — ${state.record.proposal.summary}` : item.operation.rationale || "No rationale supplied."));
  
  const content = $("#diff-content");
  content.replaceChildren();
  if (item.kind === "plan") {
    content.append(renderPlan(item));
  } else {
    const { before, after } = operationSources(item.operation);
    const pairs = alignedDiff(before, after);
    if (state.view === "split") content.append(renderSplitDiff(item, pairs));
    else content.append(renderUnifiedDiff(item, pairs));
  }
  renderTree();
}

function renderTree() {
  const tree = $("#change-tree");
  tree.replaceChildren();
  const groups = new Map();
  for (const item of state.items) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  for (const [group, items] of groups) {
    tree.append(element("div", "tree-group", group));
    for (const item of items) {
      const stats = statsForItem(item);
      const studioIcon = getItemStudioIcon(item);
      const button = element("button", `change-item${item.key === state.selectedKey ? " active" : ""}${state.viewed.has(item.key) ? " viewed" : ""}`);
      
      const iconSpan = element("span", `item-icon ${studioIcon.className}`, studioIcon.icon);
      const stat = element("span", "item-stats");
      stat.append(element("span", "added", `+${stats.added}`), element("span", "removed", `−${stats.removed}`));
      
      button.append(iconSpan, element("span", "item-label", item.label), stat);
      button.title = item.kind === "plan" ? "Proposal plan" : operationPath(item.operation);
      button.addEventListener("click", () => {
        state.selectedKey = item.key;
        state.anchor = null;
        closeInlinePopover();
        $("#comment-composer").hidden = true;
        renderChange();
      });
      tree.append(button);
    }
  }
  $("#change-count").textContent = `${state.viewed.size}/${state.items.length}`;
}

function renderAnnotations() {
  const list = $("#annotation-list");
  list.replaceChildren();
  $("#annotation-count").textContent = String(state.annotations.length);
  $("#annotation-empty").hidden = state.annotations.length > 0 || !$("#comment-composer").hidden;
  state.annotations.forEach((annotation, index) => {
    const card = element("article", "annotation");
    const remove = element("button", "", "×");
    remove.setAttribute("aria-label", "Remove comment");
    remove.addEventListener("click", () => {
      state.annotations.splice(index, 1);
      renderAnnotations();
      renderChange();
      scheduleDraftSave();
    });
    const path = annotation.operationId
      ? operationPath(state.record.proposal.operations.find((operation) => operation.id === annotation.operationId))
      : "plan.md";
    
    const lineStr = (annotation.lineStart && annotation.lineStart !== annotation.lineEnd)
      ? `${annotation.side ? annotation.side + " " : ""}lines ${annotation.lineStart}–${annotation.lineEnd}`
      : `${annotation.side ? annotation.side + " " : ""}line ${annotation.lineEnd || annotation.line}`;

    card.append(remove, element("div", "annotation-meta", `${path} · ${lineStr}`), element("p", "", annotation.body));
    list.append(card);
  });
}

function renderProposal(record) {
  state.record = record;
  state.items = createItems(record);
  const recordedComments = record.decision?.comments || [];
  state.annotations = recordedComments.filter((comment) => comment.line !== undefined);
  $("#general-comment").value = recordedComments
    .filter((comment) => comment.line === undefined)
    .map((comment) => comment.body)
    .join("\n\n");
  state.viewed = new Set();
  state.draftGeneration = 0;
  state.draftIdentity = recordIdentity(record);
  const firstScript = state.items.find((item) => item.kind === "replaceScriptSource");
  state.selectedKey = firstScript?.key || state.items[0]?.key;
  $("#breadcrumb").textContent = `${record.proposal.producer.name}/${record.proposal.proposalId} · r${record.proposal.revision}`;
  $("#review-summary").replaceChildren();
  $("#review-summary").append(
    element("strong", "", record.proposal.title),
    document.createElement("br"),
    document.createTextNode(`${record.proposal.operations.length} operations · ${record.status.replaceAll("_", " ").toLowerCase()}`),
  );
  const decided = Boolean(record.decision);
  $("#approve").disabled = decided;
  $("#request-changes").disabled = decided;
  $("#reject").disabled = decided;
  $("#decision-state").textContent = decided
    ? `Decision recorded: ${record.status.replaceAll("_", " ").toLowerCase()}.`
    : "Approval permits Studio preflight. Nothing is applied from this page.";
  $("#auth-state").hidden = true;
  $("#review-workspace").hidden = false;
  
  const preflightAlert = $("#preflight-alert");
  if (record.status === "CONFLICTED" || (record.preflight && record.preflight.errors && record.preflight.errors.length > 0)) {
    preflightAlert.hidden = false;
    preflightAlert.replaceChildren();
    const strong = element("strong", "", "⚠️ Studio Preflight Conflict");
    const list = element("ul", "");
    for (const err of record.preflight.errors) {
      list.append(element("li", "", err));
    }
    preflightAlert.append(strong, list);
  } else {
    preflightAlert.hidden = true;
    preflightAlert.replaceChildren();
  }

  renderRevisionContext(record);
  renderTree();
  renderAnnotations();
  renderChange();
  void restoreDraft(record);

  if (!record.reviewedAt) {
    void api(`/v1/proposals/${encodeURIComponent(record.proposal.proposalId)}/${record.proposal.revision}/reviewed`, {
      method: "POST",
      body: "{}",
    }).then((updated) => {
      const index = state.records.findIndex((candidate) => recordIdentity(candidate) === recordIdentity(updated));
      if (index >= 0) state.records[index] = updated;
      if (recordIdentity() === recordIdentity(updated)) state.record = updated;
    }).catch((error) => toast(error.message));
  }
}

function renderRevisionContext(record) {
  const previous = record.proposal.previousRevision === undefined
    ? null
    : state.records.find((candidate) => candidate.proposal.proposalId === record.proposal.proposalId
      && candidate.proposal.revision === record.proposal.previousRevision);
  const summary = $("#revision-summary");
  const feedback = $("#previous-feedback");
  if (!previous) {
    summary.hidden = true;
    feedback.hidden = true;
    return;
  }
  const previousOperations = new Map(previous.proposal.operations.map((operation) => [operation.id, operation]));
  const currentOperations = new Map(record.proposal.operations.map((operation) => [operation.id, operation]));
  const added = [...currentOperations.keys()].filter((id) => !previousOperations.has(id));
  const removed = [...previousOperations.keys()].filter((id) => !currentOperations.has(id));
  const changed = [...currentOperations.keys()].filter((id) => previousOperations.has(id)
    && JSON.stringify(currentOperations.get(id)) !== JSON.stringify(previousOperations.get(id)));
  const operationDetails = [
    added.length > 0 ? `added: ${added.join(", ")}` : "",
    changed.length > 0 ? `changed: ${changed.join(", ")}` : "",
    removed.length > 0 ? `removed: ${removed.join(", ")}` : "",
  ].filter(Boolean).join("; ") || "typed operations unchanged";
  summary.textContent = `Since r${previous.proposal.revision}: plan ${record.proposal.plan.content === previous.proposal.plan.content ? "unchanged" : "changed"}; ${operationDetails}.`;
  summary.hidden = false;
  const priorComments = previous.decision?.comments || [];
  feedback.textContent = priorComments.length === 0
    ? `Previous review (r${previous.proposal.revision}) recorded no written feedback.`
    : `Previous feedback from r${previous.proposal.revision}:\n${priorComments.map((comment, index) => `${index + 1}. ${comment.body}`).join("\n")}`;
  feedback.hidden = false;
}

function populateProposalPicker() {
  const picker = $("#proposal-picker");
  const currentValue = state.record ? `${state.record.proposal.proposalId}:${state.record.proposal.revision}` : picker.value;
  picker.replaceChildren();
  for (const record of state.records) {
    const option = element("option", "", `${record.reviewedAt ? "Reviewed" : "Unread"} · ${record.proposal.title} · r${record.proposal.revision}`);
    option.value = `${record.proposal.proposalId}:${record.proposal.revision}`;
    picker.append(option);
  }
  if (currentValue) picker.value = currentValue;
}

$("#proposal-picker").addEventListener("change", async () => {
  const picker = $("#proposal-picker");
  const record = state.records.find((candidate) => `${candidate.proposal.proposalId}:${candidate.proposal.revision}` === picker.value);
  if (record) {
    window.clearTimeout(state.draftTimer);
    await saveDraftNow();
    renderProposal(record);
  }
});


function collectComments() {
  const comments = [...state.annotations];
  const general = $("#general-comment").value.trim();
  if (general) comments.push({ body: general });
  return comments;
}

async function decide(kind) {
  if (!state.record) return;
  const comments = collectComments();
  if (kind === "REQUEST_CHANGES" && comments.length === 0) {
    toast("Add an annotation or overall review note first.");
    $("#general-comment").focus();
    return;
  }
  try {
    window.clearTimeout(state.draftTimer);
    await saveDraftNow();
    const { proposal } = state.record;
    const updated = await api(`/v1/proposals/${encodeURIComponent(proposal.proposalId)}/${proposal.revision}/decision`, {
      method: "POST",
      body: JSON.stringify({ kind, comments }),
    });
    const recordIndex = state.records.findIndex((record) => record.proposal.proposalId === proposal.proposalId && record.proposal.revision === proposal.revision);
    state.records[recordIndex] = updated;
    renderProposal(updated);
    toast(kind === "APPROVE" ? "Approved for Studio preflight—not applied." : "Feedback sent to the proposal producer.");
  } catch (error) {
    toast(error.message);
  }
}

function selectedRawDiff() {
  const item = currentItem();
  if (!item) return "";
  if (item.kind === "plan") return state.record.proposal.plan.content;
  const { before, after } = operationSources(item.operation);
  return rawDiff(before, after).map((token) => `${token.kind === "added" ? "+" : token.kind === "removed" ? "-" : " "}${token.text}`).join("\n");
}

// Inline Popover Event Listeners
$("#btn-quick-suggest").addEventListener("click", () => {
  const textarea = $("#inline-comment-body");
  const snippet = "```suggestion\n-- Enter suggested Luau code here\n```";
  textarea.value = textarea.value ? `${textarea.value}\n${snippet}` : snippet;
  textarea.focus();
});

$("#btn-quick-revert").addEventListener("click", () => {
  const textarea = $("#inline-comment-body");
  textarea.value = "Revert this change.";
  textarea.focus();
});

$("#btn-quick-optimize").addEventListener("click", () => {
  const textarea = $("#inline-comment-body");
  const msg = "Please refactor/optimize this section for better Luau performance and memory.";
  textarea.value = textarea.value ? `${textarea.value}\n${msg}` : msg;
  textarea.focus();
});

$("#inline-popover-close").addEventListener("click", closeInlinePopover);
$("#inline-cancel-comment").addEventListener("click", closeInlinePopover);
$("#inline-add-comment").addEventListener("click", () => {
  const body = $("#inline-comment-body").value.trim();
  if (!body || !state.selectedRange) return;
  const { operationId, lineStart, lineEnd, side } = state.selectedRange;
  state.annotations.push({
    body,
    ...(operationId ? { operationId } : {}),
    line: lineEnd,
    lineStart,
    lineEnd,
    side,
  });
  closeInlinePopover();
  renderAnnotations();
  renderChange();
  scheduleDraftSave();
});

// View Toggle Listeners
$("#split-view").addEventListener("click", () => {
  state.view = "split";
  $("#split-view").classList.add("active");
  $("#unified-view").classList.remove("active");
  renderChange();
});
$("#unified-view").addEventListener("click", () => {
  state.view = "unified";
  $("#unified-view").classList.add("active");
  $("#split-view").classList.remove("active");
  renderChange();
});

// Modal Event Listeners
$("#plan-style-toggle").addEventListener("click", () => {
  const modal = $("#modal-plan-style");
  document.querySelectorAll(".plan-option-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.style === state.planStyle);
  });
  modal.hidden = false;
});

document.querySelectorAll(".plan-option-card").forEach((card) => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".plan-option-card").forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
  });
});

$("#btn-save-plan-style").addEventListener("click", () => {
  const activeCard = document.querySelector(".plan-option-card.active");
  if (activeCard) {
    state.planStyle = activeCard.dataset.style;
    localStorage.setItem("roview-plan-style", state.planStyle);
  }
  $("#modal-plan-style").hidden = true;
  renderChange();
});

$("#onboarding-toggle").addEventListener("click", () => {
  $("#modal-onboarding").hidden = false;
});
$("#btn-close-onboarding").addEventListener("click", () => {
  $("#modal-onboarding").hidden = true;
  localStorage.setItem("roview-onboarded", "true");
});

// Shortcuts Modal
$("#shortcuts-toggle").addEventListener("click", () => {
  $("#modal-shortcuts").hidden = false;
});
$("#status-shortcuts-btn").addEventListener("click", () => {
  $("#modal-shortcuts").hidden = false;
});
$("#btn-close-shortcuts").addEventListener("click", () => {
  $("#modal-shortcuts").hidden = true;
});

$("#viewed-toggle").addEventListener("click", () => {
  const item = currentItem();
  if (!item) return;
  if (state.viewed.has(item.key)) state.viewed.delete(item.key);
  else state.viewed.add(item.key);
  renderChange();
  scheduleDraftSave();
});

$("#copy-diff").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(selectedRawDiff());
    toast("Raw diff copied.");
  } catch {
    toast("Clipboard access was not available.");
  }
});

$("#cancel-comment").addEventListener("click", () => {
  state.anchor = null;
  $("#comment-composer").hidden = true;
  renderAnnotations();
});

$("#add-comment").addEventListener("click", () => {
  const body = $("#comment-body").value.trim();
  if (!body || !state.anchor) return;
  state.annotations.push({
    body,
    ...(state.anchor.operationId ? { operationId: state.anchor.operationId } : {}),
    line: state.anchor.line,
    lineStart: state.anchor.line,
    lineEnd: state.anchor.line,
    side: state.anchor.side,
  });
  state.anchor = null;
  $("#comment-composer").hidden = true;
  renderAnnotations();
  renderChange();
  scheduleDraftSave();
});

$("#request-changes").addEventListener("click", () => decide("REQUEST_CHANGES"));
$("#reject").addEventListener("click", () => decide("REJECT"));
$("#approve").addEventListener("click", () => decide("APPROVE"));
$("#general-comment").addEventListener("input", scheduleDraftSave);

// Drag selection for line ranges
let isDragging = false;
let dragStartLine = null;
let dragSide = null;
let dragOpId = null;

const diffContentEl = $("#diff-content");
diffContentEl.addEventListener("mousedown", (e) => {
  const lineWrap = e.target.closest(".line-wrap");
  if (!lineWrap || e.target.classList.contains("add-line-comment")) return;
  
  const item = currentItem();
  if (!item) return;
  
  const line = parseInt(lineWrap.getAttribute("data-line"), 10);
  const side = lineWrap.getAttribute("data-side");
  const opId = item.kind === "plan" ? undefined : item.operation.id;
  
  if (!isNaN(line)) {
    isDragging = true;
    dragStartLine = line;
    dragSide = side;
    dragOpId = opId;
    
    document.querySelectorAll(".line-selected").forEach(el => el.classList.remove("line-selected"));
    lineWrap.classList.add("line-selected");
  }
});

diffContentEl.addEventListener("mouseover", (e) => {
  if (!isDragging) return;
  const lineWrap = e.target.closest(".line-wrap");
  if (!lineWrap) return;
  
  const currentLine = parseInt(lineWrap.getAttribute("data-line"), 10);
  const currentSide = lineWrap.getAttribute("data-side");
  
  if (!isNaN(currentLine) && currentSide === dragSide) {
    const start = Math.min(dragStartLine, currentLine);
    const end = Math.max(dragStartLine, currentLine);
    
    document.querySelectorAll(".line-selected").forEach(el => el.classList.remove("line-selected"));
    
    document.querySelectorAll(`.line-wrap[data-side="${dragSide}"]`).forEach((el) => {
      const l = parseInt(el.getAttribute("data-line"), 10);
      if (l >= start && l <= end) el.classList.add("line-selected");
    });
  }
});

window.addEventListener("mouseup", () => {
  if (!isDragging) return;
  isDragging = false;
  
  const selectedEls = document.querySelectorAll(".line-selected");
  if (selectedEls.length > 0) {
    const lines = [...selectedEls].map(el => parseInt(el.getAttribute("data-line"), 10)).filter(n => !isNaN(n));
    if (lines.length > 0) {
      const start = Math.min(...lines);
      const end = Math.max(...lines);
      const lastEl = selectedEls[selectedEls.length - 1];
      const item = currentItem();
      const path = item.kind === "plan" ? "plan.md" : operationPath(item.operation);
      
      openInlinePopover({
        operationId: dragOpId,
        lineStart: start,
        lineEnd: end,
        side: dragSide,
        path,
      }, lastEl);
    }
  }
});

// Keyboard Navigation & Shortcuts
window.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
    if (e.key === "Escape") {
      document.activeElement.blur();
      closeInlinePopover();
    }
    return;
  }

  if (e.key === "Escape") {
    closeInlinePopover();
    $("#modal-plan-style").hidden = true;
    $("#modal-onboarding").hidden = true;
    $("#modal-shortcuts").hidden = true;
    return;
  }

  if (e.key === "?" || (e.shiftKey && e.key === "/")) {
    e.preventDefault();
    $("#modal-shortcuts").hidden = !$("#modal-shortcuts").hidden;
    return;
  }

  if (e.key === "j" || e.key === "ArrowDown") {
    e.preventDefault();
    const currentIndex = state.items.findIndex(item => item.key === state.selectedKey);
    if (currentIndex >= 0 && currentIndex < state.items.length - 1) {
      state.selectedKey = state.items[currentIndex + 1].key;
      renderChange();
    }
    return;
  }

  if (e.key === "k" || e.key === "ArrowUp") {
    e.preventDefault();
    const currentIndex = state.items.findIndex(item => item.key === state.selectedKey);
    if (currentIndex > 0) {
      state.selectedKey = state.items[currentIndex - 1].key;
      renderChange();
    }
    return;
  }

  if (e.key === "s") {
    e.preventDefault();
    state.view = state.view === "split" ? "unified" : "split";
    $("#split-view").classList.toggle("active", state.view === "split");
    $("#unified-view").classList.toggle("active", state.view === "unified");
    renderChange();
    return;
  }

  if (e.key === "v") {
    e.preventDefault();
    const item = currentItem();
    if (item) {
      if (state.viewed.has(item.key)) state.viewed.delete(item.key);
      else state.viewed.add(item.key);
      renderChange();
      scheduleDraftSave();
    }
    return;
  }

  if (e.key === "a" && !$("#approve").disabled) {
    e.preventDefault();
    void decide("APPROVE");
    return;
  }

  if (e.key === "r" && !$("#request-changes").disabled) {
    e.preventDefault();
    void decide("REQUEST_CHANGES");
    return;
  }

  if (e.key === "x" && !$("#reject").disabled) {
    e.preventDefault();
    void decide("REJECT");
    return;
  }
});

function startRealtimeSync() {
  let isSyncing = false;
  async function syncLoop() {
    if (!state.token || isSyncing) return;
    isSyncing = true;
    const dot = $("#connection-dot");
    const label = $("#connection-label");
    try {
      if (dot) dot.className = "connection-dot syncing";
      if (label) label.textContent = "Syncing with Studio…";
      const result = await api(`/v1/proposals?after=${state.cursor}&waitMs=15000`);
      if (result && typeof result.cursor === "number") {
        state.cursor = result.cursor;
      }
      if (result && Array.isArray(result.proposals)) {
        state.records = result.proposals;
        populateProposalPicker();

        if (state.record) {
          const updated = state.records.find((candidate) => recordIdentity(candidate) === recordIdentity(state.record));
          if (updated) {
            const statusChanged = state.record.status !== updated.status;
            const preflightChanged = JSON.stringify(state.record.preflight) !== JSON.stringify(updated.preflight);
            const decisionChanged = JSON.stringify(state.record.decision) !== JSON.stringify(updated.decision);
            const applyChanged = JSON.stringify(state.record.applyResult) !== JSON.stringify(updated.applyResult);
            if (statusChanged || preflightChanged || decisionChanged || applyChanged) {
              state.record = updated;
              renderRecord(updated);
            }
          }
        } else if (state.records.length > 0) {
          const first = state.records.find((r) => r.status === "READY_FOR_REVIEW" || r.status === "APPROVED") || state.records[state.records.length - 1];
          if (first) renderProposal(first);
        }
      }
      if (dot) dot.className = "connection-dot";
      if (label) label.textContent = "Live Sync Active";
    } catch (err) {
      if (dot) dot.className = "connection-dot offline";
      if (label) label.textContent = "Reconnecting…";
      await new Promise((resolve) => setTimeout(resolve, 2500));
    } finally {
      isSyncing = false;
      setTimeout(syncLoop, 300);
    }
  }
  void syncLoop();
}

async function initialise() {
  state.token = readToken();
  if (!state.token) {
    try {
      const sessRes = await fetch("/v1/session");
      if (sessRes.ok) {
        const sessData = await sessRes.json();
        if (sessData && sessData.token) {
          state.token = sessData.token;
          sessionStorage.setItem("roview-token", state.token);
        }
      }
    } catch {}
  }
  if (!state.token) {
    $("#auth-state h1").textContent = "Session token required";
    $("#auth-state p").textContent = "Open the exact review URL printed by the Roview companion.";
    return;
  }
  try {
    const result = await api("/v1/proposals");
    state.records = result.proposals || [];
    if (typeof result.cursor === "number") {
      state.cursor = result.cursor;
    }
    populateProposalPicker();
    const first = state.records.find((record) => record.status === "READY_FOR_REVIEW" || record.status === "APPROVED") || state.records[state.records.length - 1];
    if (first) renderProposal(first);
    else {
      $("#auth-state h1").textContent = "No proposals to review";
      $("#auth-state p").textContent = "Submit a change set through the local companion.";
    }
    
    if (!localStorage.getItem("roview-onboarded")) {
      $("#modal-onboarding").hidden = false;
    }

    startRealtimeSync();
  } catch (error) {
    $("#auth-state h1").textContent = "Could not open the review";
    $("#auth-state p").textContent = error.message;
  }
}

await initialise();

