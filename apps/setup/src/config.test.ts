import { describe, expect, it } from "vitest";
import {
  CLIENT_REGISTRY,
  generateMcpConfiguration,
  mergeMcpConfiguration,
  resolveClientPaths,
} from "./config.js";
import { policyRelativePath, type PolicyClient } from "./policy.js";

describe("dual MCP onboarding configuration", () => {
  it("configures official Roblox Studio MCP beside the narrow Roview companion", () => {
    expect(generateMcpConfiguration({
      mode: "companion",
      projectRoot: "/workspace/roview",
      token: "test-token",
      platform: "darwin",
      environment: {},
    })).toEqual({
      mcpServers: {
        Roblox_Studio: { command: "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP" },
        roview: {
          command: "pnpm",
          args: ["--dir", "/workspace/roview", "mcp"],
          env: { ROVIEW_TOKEN: "test-token", ROVIEW_URL: "http://127.0.0.1:3219" },
        },
      },
    });

    expect(generateMcpConfiguration({
      mode: "companion",
      projectRoot: "/workspace/roview",
      platform: "darwin",
      environment: {},
    })).toEqual({
      mcpServers: {
        Roblox_Studio: { command: "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP" },
        roview: {
          command: "pnpm",
          args: ["--dir", "/workspace/roview", "mcp"],
          env: { ROVIEW_URL: "http://127.0.0.1:3219" },
        },
      },
    });

    expect(generateMcpConfiguration({
      mode: "companion",
      projectRoot: "/workspace/roview",
      platform: "linux",
      environment: { ROBLOX_STUDIO_MCP_PATH: "/usr/local/bin/roblox-mcp" },
    })).toEqual({
      mcpServers: {
        Roblox_Studio: { command: "/usr/local/bin/roblox-mcp" },
        roview: {
          command: "pnpm",
          args: ["--dir", "/workspace/roview", "mcp"],
          env: { ROVIEW_URL: "http://127.0.0.1:3219" },
        },
      },
    });
  });


  it("configures only the enforcing gateway in Safe Mode", () => {
    const configuration = generateMcpConfiguration({
      mode: "safe",
      projectRoot: "/workspace/roview",
      token: "test-token",
      platform: "darwin",
      environment: {},
    });
    expect(Object.keys(configuration.mcpServers)).toEqual(["roview_safe"]);
    expect(configuration.mcpServers.roview_safe?.args).toContain("mcp:safe");
  });

  it("preserves unrelated servers and refuses conflicting replacements by default", () => {
    const existing = { mcpServers: { github: { command: "github-mcp" }, roview: { command: "old" } } };
    const incoming = { mcpServers: { roview: { command: "new" } } };
    expect(() => mergeMcpConfiguration(existing, incoming)).toThrow("without --force");
    expect(mergeMcpConfiguration(existing, incoming, true)).toEqual({
      mcpServers: { github: { command: "github-mcp" }, roview: { command: "new" } },
    });
  });

  it("removes direct Studio access when switching to Safe Mode", () => {
    const current = {
      mcpServers: {
        github: { command: "github-mcp" },
        Roblox_Studio: { command: "official" },
        roview: { command: "pnpm", args: ["mcp"] },
      },
    };
    const incoming = { mcpServers: { roview_safe: { command: "pnpm", args: ["mcp:safe"] } } };

    expect(mergeMcpConfiguration(current, incoming, false, ["Roblox_Studio", "roview"])).toEqual({
      mcpServers: {
        github: { command: "github-mcp" },
        roview_safe: { command: "pnpm", args: ["mcp:safe"] },
      },
    });
  });

  it("resolves client paths correctly for all supported clients", () => {
    const clients: PolicyClient[] = [
      "antigravity",
      "cursor",
      "claude",
      "windsurf",
      "cline",
      "roo",
      "codex",
      "generic",
    ];

    const projectRoot = "/test/project";
    const userHome = "/home/user";

    for (const client of clients) {
      expect(CLIENT_REGISTRY[client]).toBeDefined();
      const { mcpConfigPath, policyPath } = resolveClientPaths(client, projectRoot, userHome, "darwin");
      expect(policyPath).toBeDefined();
      expect(policyPath).toContain(projectRoot);
      expect(policyPath).toContain(policyRelativePath(client));

      if (client === "antigravity") {
        expect(mcpConfigPath).toBe("/test/project/.gemini/mcp.json");
        expect(policyPath).toBe("/test/project/.gemini/rules/roview.md");
      }
      if (client === "cursor") {
        expect(mcpConfigPath).toBe("/test/project/.cursor/mcp.json");
        expect(policyPath).toBe("/test/project/.cursor/rules/roview.mdc");
      }
      if (client === "claude") {
        expect(mcpConfigPath).toBe("/home/user/Library/Application Support/Claude/claude_desktop_config.json");
        expect(policyPath).toBe("/test/project/CLAUDE.roview.md");
      }
    }
  });
});

