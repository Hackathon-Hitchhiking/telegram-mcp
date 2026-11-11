import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type HistoryPageOptions, SENT_MEDIA_FILTERS, type SentMediaFilter } from "../advanced-messages.js";
import type { TelegramService } from "../telegram-client.js";
import { fail, ok, READ_ONLY, requireConnection } from "./shared.js";

export interface AdvancedMessagesService {
  getMessagesByIds(chatId: string, messageIds: number[]): Promise<unknown>;
  getHistoryPage(chatId: string, options: HistoryPageOptions): Promise<unknown>;
  searchSentMedia(query: string, filter: SentMediaFilter, limit: number): Promise<unknown>;
}

const id = z.number().int().min(1).max(2_147_483_647);
const offset = z.number().int().min(0).max(2_147_483_647);

export function registerAdvancedMessageTools(server: McpServer, telegram: TelegramService & AdvancedMessagesService) {
  server.registerTool(
    "telegram-get-messages-by-id",
    {
      description:
        "Read exact message IDs from one resolved chat. Returns only messages whose peer matches that chat, in requested ID order; missing or inaccessible IDs are labelled. Does not mark messages read.",
      inputSchema: {
        chatId: z.string().trim().min(1).describe("Exact chat ID or username"),
        messageIds: z.array(id).min(1).max(100).describe("1–100 distinct message IDs"),
      },
      annotations: READ_ONLY,
    },
    async ({ chatId, messageIds }) => {
      const err = await requireConnection(telegram);
      if (err) return fail(new Error(err));
      try {
        return ok(JSON.stringify(await telegram.getMessagesByIds(chatId, messageIds)));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "telegram-get-history-page",
    {
      description:
        "Read one native messages.getHistory page, newest first, with full ID/date/addOffset/minId/maxId pagination. ID bounds are exclusive. nextOffsetId is the last native row; continue until an empty page to establish the end. Does not mark messages read.",
      inputSchema: {
        chatId: z.string().trim().min(1).describe("Exact chat ID or username"),
        limit: z.number().int().min(1).max(100).default(20),
        offsetId: offset.optional().describe("Native starting message ID; 0 starts at the newest"),
        offsetDate: offset.optional().describe("Unix timestamp: messages before this date; 0 disables"),
        addOffset: z.number().int().min(-2_147_483_648).max(2_147_483_647).optional(),
        minId: offset.optional().describe("Return IDs strictly greater than minId; 0 disables"),
        maxId: offset.optional().describe("Return IDs strictly less than maxId; 0 disables"),
      },
      annotations: READ_ONLY,
    },
    async ({ chatId, ...options }) => {
      const err = await requireConnection(telegram);
      if (err) return fail(new Error(err));
      try {
        return ok(JSON.stringify(await telegram.getHistoryPage(chatId, options)));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "telegram-search-sent-media",
    {
      description:
        "Search recently sent media across chats with a native media filter. This Telegram method does not support pagination; output is capped at 100 rows and text is bounded. Telegram can reject filters unsupported by the account/server. Does not mark messages read.",
      inputSchema: {
        query: z.string().max(1_024).default(""),
        filter: z.enum(SENT_MEDIA_FILTERS).default("document"),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: READ_ONLY,
    },
    async ({ query, filter, limit }) => {
      const err = await requireConnection(telegram);
      if (err) return fail(new Error(err));
      try {
        return ok(JSON.stringify(await telegram.searchSentMedia(query, filter, limit)));
      } catch (error) {
        return fail(error);
      }
    },
  );
}
