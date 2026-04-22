import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpContext } from "./context.js";

/**
 * Register lifecycle-related handlers.
 * Note: session_start, session_end, observe are registered as regular tools
 * via tool-definitions.ts and tool-handlers.ts.
 *
 * This module is reserved for future MCP notifications/resources if needed.
 */
export function registerLifecycleHandlers(_server: Server, _ctx: McpContext): void {
	// Future: could register MCP notifications for lifecycle events
	// e.g. server.sendNotification on trust status changes
}
