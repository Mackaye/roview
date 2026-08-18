import type { Tool } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import {
  resolveStudioMcpCommand,
  selectSafeStudioTools,
} from "./studio-gateway.js";

const tool = (name: string): Tool => ({
  name,
  description: `${name} description`,
  inputSchema: { type: "object", properties: {} },
});

describe("Roblox Studio Safe Mode selection", () => {
  it("allows known inspection and playtest tools while blocking mutation and unknown tools", () => {
    const selected = selectSafeStudioTools([
      tool("script_read"),
      tool("screen_capture"),
      tool("start_stop_play"),
      tool("multi_edit"),
      tool("execute_luau"),
      tool("generate_mesh"),
      tool("future_unreviewed_tool"),
    ]).map((item) => item.name);

    expect(selected).toEqual(["script_read", "screen_capture", "start_stop_play"]);
  });

  it("resolves official Studio MCP commands without invoking a shell on macOS", () => {
    expect(resolveStudioMcpCommand("darwin", {})).toEqual({
      command: "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP",
      args: [],
    });
  });

  it("validates explicit command arguments", () => {
    expect(() => resolveStudioMcpCommand("linux", {
      ROVIEW_STUDIO_MCP_COMMAND: "/opt/studio-mcp",
      ROVIEW_STUDIO_MCP_ARGS: "{}",
    })).toThrow("JSON array of strings");
  });
});
