import { McpServer } from "@modelcontextprotocol/server";
import { RoviewClient } from "./client.js";
import { getReview, reviewChanges, reviewChangesSchema, reviewStatusSchema } from "./tools.js";

interface McpServerOptions {
  client: RoviewClient;
  openBrowser?: (url: string) => void;
}

const toolResult = (text: string, record: unknown) => ({
  content: [{ type: "text" as const, text }],
  structuredContent: { record },
});

export const roviewInstructions = [
  "Use Roblox Studio MCP to inspect the open place and obtain exact current values and script source hashes.",
  "Use Roview review_changes before any supported mutation. Human approval only unlocks Roview's Studio-side preflight.",
  "Never bypass Roview approval by applying the reviewed operations through Roblox Studio MCP tools.",
  "When changes are requested, preserve proposalId, increment revision, refresh preconditions, and resubmit.",
].join(" ");

export function registerRoviewTools(server: McpServer, options: McpServerOptions) {
  server.registerTool(
    "review_changes",
    {
      title: "Review Roblox Studio changes",
      description: "Submit a typed, non-executable Roblox Studio change proposal for human review and wait for structured approval or feedback. This never applies changes. Inspect current Studio state first with Roblox Studio MCP, including exact script SHA-256 preconditions.",
      inputSchema: reviewChangesSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
    },
    async (input, context) => {
      const result = await reviewChanges(
        options.client,
        input,
        context.mcpReq.signal,
        options.openBrowser ? { openBrowser: options.openBrowser } : {},
      );
      return toolResult(result.text, result.record);
    },
  );

  server.registerTool(
    "get_review",
    {
      title: "Get Roview review",
      description: "Get or wait for the human decision on an existing Roview proposal revision. Returns anchored feedback directly to the calling agent.",
      inputSchema: reviewStatusSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
    },
    async (input, context) => {
      const result = await getReview(options.client, input, context.mcpReq.signal);
      return toolResult(result.text, result.record);
    },
  );

  return server;
}

export function createRoviewMcpServer(options: McpServerOptions) {
  const server = new McpServer(
    { name: "roview", version: "0.1.0-draft.0" },
    { instructions: roviewInstructions },
  );

  return registerRoviewTools(server, options);
}
