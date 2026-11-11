import assert from "node:assert";
import { describe, it } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import bigInt from "big-integer";
import { Api } from "telegram/tl/index.js";
import {
  type AdvancedMessagesContext,
  getHistoryPage,
  getMessagesByIds,
  searchSentMedia,
} from "../advanced-messages.js";
import type { TelegramService } from "../telegram-client.js";
import { type AdvancedMessagesService, registerAdvancedMessageTools } from "../tools/advanced-messages.js";

const inputUser = new Api.InputPeerUser({ userId: bigInt(7), accessHash: bigInt(8) });
const peerUser = new Api.PeerUser({ userId: bigInt(7) });

function message(id: number, peerId: Api.TypePeer = peerUser, text = `message ${id}`): Api.Message {
  return new Api.Message({ id, peerId, fromId: peerUser, date: 1_000 + id, message: text });
}

function context(input: Api.TypeInputPeer, result: unknown, calls: Api.AnyRequest[]): AdvancedMessagesContext {
  return {
    resolvePeer: async (chatId) => {
      assert.strictEqual(chatId, "target");
      return "resolved";
    },
    client: {
      getInputEntity: async (peer) => {
        assert.strictEqual(peer, "resolved");
        return input;
      },
      invoke: async (request) => {
        calls.push(request);
        return result;
      },
      getMe: async () => ({ id: bigInt(7) }),
    },
  };
}

describe("exact message reads", () => {
  it("routes private/group IDs to GetMessages, preserves requested order and rejects foreign-chat bodies", async () => {
    const calls: Api.AnyRequest[] = [];
    const result = await getMessagesByIds(
      context(
        inputUser,
        {
          messages: [
            message(2),
            message(1),
            message(3, new Api.PeerUser({ userId: bigInt(99) }), "private foreign text"),
          ],
        },
        calls,
      ),
      "target",
      [1, 3, 2, 4],
    );
    assert.ok(calls[0] instanceof Api.messages.GetMessages);
    assert.deepStrictEqual(
      (calls[0] as Api.messages.GetMessages).id.map((value) => (value as Api.InputMessageID).id),
      [1, 3, 2, 4],
    );
    assert.deepStrictEqual(
      result.messages.map((item) => item.id),
      [1, 2],
    );
    assert.deepStrictEqual(result.notReturnedIds, [3, 4]);
    assert.ok(!JSON.stringify(result).includes("foreign text"));
    assert.strictEqual(calls.length, 1, "no read-history/mark-as-read request is issued");
  });

  it("routes channel IDs to channels.GetMessages using the resolved access hash", async () => {
    const calls: Api.AnyRequest[] = [];
    const input = new Api.InputPeerChannel({ channelId: bigInt(42), accessHash: bigInt(43) });
    const result = await getMessagesByIds(
      context(input, { messages: [message(1, new Api.PeerChannel({ channelId: bigInt(42) }))] }, calls),
      "target",
      [1],
    );
    assert.ok(calls[0] instanceof Api.channels.GetMessages);
    const channel = (calls[0] as Api.channels.GetMessages).channel as Api.InputChannel;
    assert.strictEqual(channel.channelId.toString(), "42");
    assert.strictEqual(channel.accessHash.toString(), "43");
    assert.strictEqual(result.messages.length, 1);
    assert.ok(!JSON.stringify(result).includes("accessHash"));
  });

  it("routes basic groups and self without widening the result scope", async () => {
    const calls: Api.AnyRequest[] = [];
    const chat = new Api.InputPeerChat({ chatId: bigInt(20) });
    const group = await getMessagesByIds(
      context(chat, { messages: [message(1, new Api.PeerChat({ chatId: bigInt(20) }))] }, calls),
      "target",
      [1],
    );
    assert.ok(calls[0] instanceof Api.messages.GetMessages);
    assert.strictEqual(group.messages.length, 1);
    const self = await getMessagesByIds(
      context(new Api.InputPeerSelf(), { messages: [message(2)] }, calls),
      "target",
      [2],
    );
    assert.strictEqual(self.messages.length, 1);
  });

  it("rejects invalid and duplicate IDs before making a provider call", async () => {
    const calls: Api.AnyRequest[] = [];
    const ctx = context(inputUser, { messages: [] }, calls);
    for (const ids of [[], [0], [-1], [1.5], [2_147_483_648], [1, 1], Array.from({ length: 101 }, (_, i) => i + 1)]) {
      await assert.rejects(getMessagesByIds(ctx, "target", ids), /messageIds|messageId/);
    }
    assert.strictEqual(calls.length, 0);
  });

  it("caps text across a 100-message response and does not claim missing IDs are deleted", async () => {
    const calls: Api.AnyRequest[] = [];
    const messages = Array.from({ length: 100 }, (_, i) => message(i + 1, peerUser, "x".repeat(8_000)));
    const result = await getMessagesByIds(
      context(inputUser, { messages }, calls),
      "target",
      messages.map((item) => item.id),
    );
    assert.strictEqual(result.messages.length, 100);
    assert.ok(result.messages.reduce((sum, item) => sum + item.text.length, 0) <= 20_000);
    assert.strictEqual(result.textTruncated, true);
    assert.match(result.notReturnedMeaning, /not proof of deletion/);
  });
});

describe("native history pagination", () => {
  it("passes every native pagination field and preserves descending provider order", async () => {
    const calls: Api.AnyRequest[] = [];
    const result = await getHistoryPage(
      context(inputUser, { count: 80, messages: [message(9), message(8)] }, calls),
      "target",
      {
        limit: 2,
        offsetId: 10,
        offsetDate: 1_700_000_000,
        addOffset: -1,
        minId: 3,
        maxId: 20,
      },
    );
    assert.ok(calls[0] instanceof Api.messages.GetHistory);
    const request = calls[0] as Api.messages.GetHistory;
    assert.deepStrictEqual(
      [
        request.offsetId,
        request.offsetDate,
        request.addOffset,
        request.limit,
        request.minId,
        request.maxId,
        request.hash.toString(),
      ],
      [10, 1_700_000_000, -1, 2, 3, 20, "0"],
    );
    assert.deepStrictEqual(
      result.messages.map((item) => item.id),
      [9, 8],
    );
    assert.strictEqual(result.pagination.nextOffsetId, 8);
    assert.strictEqual(result.pagination.endReached, false);
    assert.strictEqual(result.count, 80);
  });

  it("establishes end only from an empty page and rejects invalid/unknown bounds", async () => {
    const calls: Api.AnyRequest[] = [];
    const ctx = context(inputUser, { messages: [] }, calls);
    const empty = await getHistoryPage(ctx, "target");
    assert.strictEqual(empty.pagination.endReached, true);
    assert.strictEqual(empty.pagination.nextOffsetId, null);
    for (const options of [{ minId: 5, maxId: 5 }, { limit: 101 }, { offsetDate: -1 }, { addOffset: 0.5 }]) {
      await assert.rejects(getHistoryPage(ctx, "target", options), /must/);
    }
    await assert.rejects(getHistoryPage(ctx, "target", { unknown: 1 } as never), /Unknown history/);
    assert.strictEqual(calls.length, 1);
  });

  it("does not emit a foreign peer's history cursor or body", async () => {
    const calls: Api.AnyRequest[] = [];
    await assert.rejects(
      getHistoryPage(
        context(inputUser, { messages: [message(999, new Api.PeerUser({ userId: bigInt(99) }))] }, calls),
        "target",
      ),
      /outside the requested chat/,
    );
  });

  it("does not mistake a malformed or not-modified provider response for the end of history", async () => {
    const calls: Api.AnyRequest[] = [];
    await assert.rejects(getHistoryPage(context(inputUser, { count: 10 }, calls), "target"), /no messages array/);
  });
});

describe("recent sent media", () => {
  it("uses the native method and reports that no pagination exists", async () => {
    const calls: Api.AnyRequest[] = [];
    const result = await searchSentMedia(
      context(inputUser, { messages: [message(1)] }, calls),
      "invoice",
      "document",
      1,
    );
    assert.ok(calls[0] instanceof Api.messages.SearchSentMedia);
    const request = calls[0] as Api.messages.SearchSentMedia;
    assert.ok(request.filter instanceof Api.InputMessagesFilterDocument);
    assert.strictEqual(request.q, "invoice");
    assert.strictEqual(request.limit, 1);
    assert.strictEqual(result.paginationSupported, false);
    assert.strictEqual(calls.length, 1);
  });

  it("rejects unsupported filters and excessive limits before provider access", async () => {
    const calls: Api.AnyRequest[] = [];
    const ctx = context(inputUser, {}, calls);
    await assert.rejects(searchSentMedia(ctx, "", "custom" as never), /Unsupported filter/);
    await assert.rejects(searchSentMedia(ctx, "x".repeat(1_025)), /1024/);
    await assert.rejects(searchSentMedia(ctx, "", "photo", 101), /limit/);
    assert.strictEqual(calls.length, 0);
  });
});

describe("advanced message tool contract", () => {
  it("exposes only read-only operations and does not call a disconnected service", async () => {
    const server = new McpServer({ name: "test", version: "0" });
    let called = false;
    const service = {
      ensureConnected: async () => false,
      lastError: "offline",
      getMessagesByIds: async () => {
        called = true;
      },
    } as unknown as TelegramService & AdvancedMessagesService;
    registerAdvancedMessageTools(server, service);
    const registered = (
      server as unknown as {
        _registeredTools: Record<
          string,
          { annotations: { readOnlyHint: boolean }; handler: (args: unknown) => Promise<unknown> }
        >;
      }
    )._registeredTools;
    assert.strictEqual(Object.keys(registered).length, 3);
    for (const tool of Object.values(registered)) assert.strictEqual(tool.annotations.readOnlyHint, true);
    const result = await registered["telegram-get-messages-by-id"].handler({ chatId: "target", messageIds: [1] });
    assert.strictEqual((result as { isError: boolean }).isError, true);
    assert.strictEqual(called, false);
  });
});
