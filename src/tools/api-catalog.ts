import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeApi, searchApi } from "../api-catalog.js";
import { fail, ok, READ_ONLY } from "./shared.js";

export function registerApiCatalogTools(server: McpServer) {
  server.registerTool(
    "telegram-api-search",
    {
      description:
        "Search the locally installed Telegram MTProto schema by method/type name, result or camelCase field. Returns bounded schema references, not executable generic methods. No Telegram connection or account access is used.",
      inputSchema: {
        query: z.string().max(160).default(""),
        kind: z.enum(["method", "constructor", "all"]).default("method"),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).max(100_000).default(0),
      },
      annotations: READ_ONLY,
    },
    async ({ query, kind, limit, offset }) => {
      try {
        return ok(JSON.stringify(searchApi(query, kind, limit, offset)));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "telegram-api-describe",
    {
      description:
        "Describe one exact Telegram TL method or constructor: parameter types, optional flags, shared flag groups, result and constructor ID. Names may use native TL or GramJS spelling. Schema reference only; does not execute methods or prove account permissions.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(160)
          .describe("Exact TL name, e.g. messages.sendMessage, or GramJS messages.SendMessage"),
        fieldOffset: z.number().int().min(0).max(100_000).default(0),
        fieldLimit: z.number().int().min(1).max(100).default(100),
      },
      annotations: READ_ONLY,
    },
    async ({ name, fieldOffset, fieldLimit }) => {
      try {
        return ok(JSON.stringify(describeApi(name, fieldOffset, fieldLimit)));
      } catch (error) {
        return fail(error);
      }
    },
  );
}
