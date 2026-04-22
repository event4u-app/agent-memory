import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpContext } from "./context.js";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";
import { handleToolCall } from "./tool-handlers.js";

/**
 * Register MCP tool handlers (ListTools + CallTool).
 */
export function registerToolHandlers(server: Server, ctx: McpContext): void {
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: TOOL_DEFINITIONS,
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;
		return handleToolCall(name, args ?? {}, ctx);
	});
}
