import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { compileRichMarkdown } from "../rich-markdown.js";
import type { RichOptions, RichReceipt } from "../rich-messages.js";
import type { TelegramService } from "../telegram-client.js";
import { fail, ok, READ_ONLY, requireConnection, sanitizeInputText, WRITE } from "./shared.js";

export interface RichMessageService {
  getRichCapabilities(): Promise<unknown>;
  getRichMessage(chatId: string, messageId: number): Promise<unknown>;
  getRichSendStatus(requestId: string): Promise<unknown>;
  writeRichMessage(
    operation: "send" | "edit" | "draft",
    chatId: string,
    requestId: string,
    markdown: string,
    options?: RichOptions,
    messageId?: number,
  ): Promise<RichReceipt>;
}

const markdown = z
  .string()
  .min(1)
  .max(131072)
  .transform(sanitizeInputText)
  .describe(
    "Rich Markdown compiled locally into native blocks; supports tables, headings, links and inline styles. No automatic text fallback.",
  );
const requestId = z
  .string()
  .uuid()
  .describe(
    "Unique UUID v4 for this exact operation. Reuse it to inspect status after a timeout; never create a new ID to blindly resend.",
  );
const messageId = z.number().int().positive().max(2147483647);
const options = {
  silent: z.boolean().optional(),
  protectContent: z.boolean().optional().describe("Prevent forwarding/saving the sent message"),
  clearDraft: z.boolean().optional(),
  replyTo: messageId.optional(),
  topicId: messageId.optional(),
  scheduleDate: z
    .number()
    .int()
    .positive()
    .max(2147483647)
    .optional()
    .describe("Future Unix timestamp; scheduled writes are acknowledged but not immediately read back"),
  rtl: z.boolean().optional(),
  noautolink: z.boolean().optional().describe("Disable automatic detection of bare URLs and other text entities"),
};

type RichWriteArguments = RichOptions & { chatId: string; requestId: string; markdown: string; messageId?: number };

export function registerRichMessageTools(server: McpServer, telegram: TelegramService & RichMessageService) {
  server.registerTool(
    "telegram-preview-rich-message",
    {
      description:
        "Compile Rich Markdown locally without sending. Returns native table/row counts, rendered text size and structured cells. Does not connect to Telegram.",
      inputSchema: { markdown, rtl: options.rtl, noautolink: options.noautolink },
      annotations: READ_ONLY,
    },
    async ({ markdown, rtl, noautolink }) => {
      try {
        return ok(JSON.stringify(compileRichMarkdown(markdown, { rtl, noautolink }).inspection));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "telegram-rich-message-capabilities",
    {
      description:
        "Read installed Telegram schema layer, account Premium and server rich_message_posting feature. Does not send or change account settings.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const error = await requireConnection(telegram);
      if (error) return fail(new Error(error));
      try {
        return ok(JSON.stringify(await telegram.getRichCapabilities()));
      } catch (error) {
        return fail(error);
      }
    },
  );

  for (const operation of ["send", "edit", "draft"] as const) {
    const name = operation === "draft" ? "telegram-save-rich-draft" : `telegram-${operation}-rich-message`;
    server.registerTool(
      name,
      {
        description: `${operation === "send" ? "Send" : operation === "edit" ? "Edit" : "Save a draft of"} a native Rich Message with tables from the existing personal account. Requires server eligibility, normally Premium. Uses a durable requestId reservation, one submission and exact-message readback for immediate sends/edits; uncertain writes are never automatically resent.`,
        inputSchema: {
          chatId: z.string().min(1),
          requestId,
          markdown,
          ...(operation === "edit" ? { messageId } : {}),
          ...(operation === "send"
            ? options
            : {
                rtl: options.rtl,
                noautolink: options.noautolink,
                ...(operation === "draft" ? { replyTo: options.replyTo, topicId: options.topicId } : {}),
              }),
        },
        annotations: WRITE,
      },
      async (args: RichWriteArguments) => {
        const error = await requireConnection(telegram);
        if (error) return fail(new Error(error));
        try {
          const { chatId, requestId, markdown, messageId: id, ...opts } = args;
          const receipt = await telegram.writeRichMessage(operation, chatId, requestId, markdown, opts, id);
          const result = ok(JSON.stringify(receipt));
          return receipt.state === "uncertain" || receipt.state === "submitting" || receipt.state === "rejected"
            ? { ...result, isError: true }
            : result;
        } catch (error) {
          return fail(error);
        }
      },
    );
  }

  server.registerTool(
    "telegram-get-rich-message",
    {
      description:
        "Read the native rich blocks of one exact message, including table headers and cells. Fetches the full rich-message API result and reports partial/unsupported content explicitly.",
      inputSchema: { chatId: z.string().min(1), messageId },
      annotations: READ_ONLY,
    },
    async ({ chatId, messageId }) => {
      const error = await requireConnection(telegram);
      if (error) return fail(new Error(error));
      try {
        return ok(JSON.stringify(await telegram.getRichMessage(chatId, messageId)));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "telegram-get-rich-send-status",
    {
      description:
        "Read the durable status of a rich send/edit/draft by requestId. Never sends, retries or changes the journal. A known messageId can be checked with telegram-get-rich-message.",
      inputSchema: { requestId },
      annotations: READ_ONLY,
    },
    async ({ requestId }) => {
      try {
        return ok(JSON.stringify(await telegram.getRichSendStatus(requestId)));
      } catch (error) {
        return fail(error);
      }
    },
  );
}
