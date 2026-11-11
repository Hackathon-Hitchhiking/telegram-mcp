import assert from "node:assert/strict";
import { describe, it } from "node:test";
import bigInt from "big-integer";
import { Api } from "telegram/tl/index.js";
import { formattingEntities, validateWriteOptions } from "../message-options.js";
import { TelegramService } from "../telegram-client.js";

const peer = new Api.InputPeerUser({ userId: bigInt(42), accessHash: bigInt(99) });
type Fields = Record<string, unknown>;

function service() {
  const calls: Fields[] = [];
  const instance = new TelegramService(1, "offline-test", { sessionPath: "/tmp/telegram-options-unused.session" });
  Object.assign(instance, {
    connected: true,
    resolvePeer: async () => peer,
    rateLimiter: { executeOnce: async (fn: () => Promise<unknown>) => fn() },
    client: {
      getInputEntity: async () => peer,
      invoke: async (request: Fields) => {
        calls.push(request);
        return new Api.UpdateShortSentMessage({ id: 7, pts: 1, ptsCount: 1, date: 1 });
      },
      sendMessage: async () => {
        throw new Error("Unexpected high-level fallback");
      },
      editMessage: async () => {
        throw new Error("Unexpected high-level fallback");
      },
    },
  });
  return { instance, calls };
}

describe("explicit UTF-16 formatting", () => {
  it("accepts complete surrogate pairs and native entity fields", () => {
    const entities = formattingEntities("A😀B", [{ type: "bold", offset: 1, length: 2 }]);
    assert.ok(entities?.[0] instanceof Api.MessageEntityBold);
    assert.equal(entities[0].offset, 1);
    assert.equal(entities[0].length, 2);
    assert.ok(
      formattingEntities("abc", [{ type: "pre", offset: 0, length: 3, language: "ts" }])?.[0] instanceof
        Api.MessageEntityPre,
    );
    const link = formattingEntities("a", [{ type: "text_url", offset: 0, length: 1, url: "https://example.com" }])?.[0];
    assert.ok(link instanceof Api.MessageEntityTextUrl);
    assert.equal(link.url, "https://example.com");
  });

  it("rejects split surrogate boundaries and invalid or out-of-text ranges", () => {
    for (const range of [
      { offset: 1, length: 1 },
      { offset: 2, length: 1 },
      { offset: 0, length: 5 },
      { offset: -1, length: 1 },
      { offset: 0, length: 0 },
      { offset: 0.5, length: 1 },
    ]) {
      assert.throws(() => formattingEntities("A😀B", [{ type: "bold", ...range }]));
    }
  });

  it("refuses ambiguous parsing, unsupported fields and dangerous URL schemes", () => {
    assert.throws(() => formattingEntities("abc", [], "md"), /mutually exclusive/);
    assert.throws(
      () => formattingEntities("abc", [{ type: "bold", offset: 0, length: 1, url: "https://example.com" }]),
      /Only text_url/,
    );
    assert.throws(
      () => formattingEntities("abc", [{ type: "bold", offset: 0, length: 1, language: "ts" }]),
      /Only pre/,
    );
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,test",
      "file:///etc/passwd",
      "httpsx://example.com",
      " https://example.com",
    ]) {
      assert.throws(() => formattingEntities("abc", [{ type: "text_url", offset: 0, length: 1, url }]), /requires/);
    }
    assert.throws(
      () =>
        formattingEntities(
          "a",
          Array.from({ length: 101 }, () => ({ type: "bold", offset: 0, length: 1 })),
        ),
      /100/,
    );
  });
});

describe("quote and schedule dependencies", () => {
  it("rejects past schedules and dependencies without their parent field", () => {
    assert.throws(() => validateWriteOptions({ scheduleDate: Math.floor(Date.now() / 1000) - 1 }), /future/);
    assert.throws(() => validateWriteOptions({ scheduleRepeatPeriod: 60 }), /requires scheduleDate/);
    assert.throws(() => validateWriteOptions({ replyToPeer: "42" }), /requires replyTo/);
    assert.throws(() => validateWriteOptions({ quoteOffset: 0, quoteText: "quote" }), /requires/);
    assert.throws(() => validateWriteOptions({ quoteOffset: 0 }, 9), /requires/);
    assert.doesNotThrow(() =>
      validateWriteOptions(
        {
          quoteText: "quote",
          quoteOffset: 0,
          replyToPeer: "42",
          scheduleDate: Math.floor(Date.now() / 1000) + 3600,
          scheduleRepeatPeriod: 86400,
        },
        9,
      ),
    );
  });
});

describe("TelegramService formatting request contract", () => {
  it("maps send flags, quotes, scheduling and send-as to native TL fields", async () => {
    const { instance, calls } = service();
    const scheduleDate = Math.floor(Date.now() / 1000) + 3600;
    await instance.sendMessage("42", "A😀B", 9, undefined, 5, {
      entities: [{ type: "bold", offset: 1, length: 2 }],
      silent: true,
      background: true,
      clearDraft: true,
      protectContent: true,
      noWebpage: true,
      invertMedia: true,
      quoteText: "original",
      quoteOffset: 0,
      replyToPeer: "43",
      sendAs: "44",
      scheduleDate,
      scheduleRepeatPeriod: 86400,
      effect: "1234567890123456789",
    });
    assert.equal(calls.length, 1);
    const request = calls[0];
    assert.ok(request instanceof Api.messages.SendMessage);
    assert.equal(request.message, "A😀B");
    for (const flag of ["silent", "background", "clearDraft", "noforwards", "noWebpage", "invertMedia"])
      assert.equal(request[flag], true);
    assert.equal(request.scheduleDate, scheduleDate);
    assert.equal(request.scheduleRepeatPeriod, 86400);
    assert.equal(String(request.effect), "1234567890123456789");
    assert.equal(request.sendAs, peer);
    const reply = request.replyTo as Api.InputReplyToMessage;
    assert.equal(reply.replyToMsgId, 9);
    assert.equal(reply.topMsgId, 5);
    assert.equal(reply.quoteText, "original");
    assert.equal(reply.quoteOffset, 0);
    assert.equal(reply.replyToPeerId, peer);
    assert.ok((request.entities as Api.TypeMessageEntity[])[0] instanceof Api.MessageEntityBold);
    // Serialization proves the installed native schema accepts the extended flags.
    assert.ok(request.getBytes().length > 0);
  });

  it("validates conflicting formatting before invoking the client", async () => {
    const { instance, calls } = service();
    await assert.rejects(
      instance.sendMessage("42", "abc", undefined, "md", undefined, { entities: [] }),
      /mutually exclusive/,
    );
    await assert.rejects(
      instance.sendMessage("42", "abc", undefined, undefined, undefined, { scheduleRepeatPeriod: 60 }),
      /scheduleDate/,
    );
    await assert.rejects(
      instance.sendMessage("42", "abc", undefined, undefined, undefined, { quoteText: "quote" }),
      /requires replyTo/,
    );
    await assert.rejects(
      instance.sendMessage("42", "abc", undefined, undefined, undefined, { parseMode: "md", entities: [] }),
      /mutually exclusive/,
    );
    await assert.rejects(
      instance.sendMessage("42", "abc", undefined, "html", undefined, { parseMode: "md" }),
      /Conflicting parseMode/,
    );
    assert.equal(calls.length, 0);
  });

  it("edits and drafts with explicit entities and preview flags without a text fallback", async () => {
    const { instance, calls } = service();
    const options = { entities: [{ type: "bold" as const, offset: 0, length: 3 }], noWebpage: true, invertMedia: true };
    await instance.editMessage("42", 11, "abc", options);
    await instance.saveDraft("42", "abc", 12, options);
    assert.equal(calls.length, 2);
    assert.ok(calls[0] instanceof Api.messages.EditMessage);
    assert.equal(calls[0].id, 11);
    assert.ok(calls[1] instanceof Api.messages.SaveDraft);
    for (const request of calls) {
      assert.equal(request.message, "abc");
      assert.equal(request.noWebpage, true);
      assert.equal(request.invertMedia, true);
      assert.ok((request.entities as Api.TypeMessageEntity[])[0] instanceof Api.MessageEntityBold);
      assert.ok((request as unknown as { getBytes(): Buffer }).getBytes().length > 0);
    }
    assert.equal((calls[1].replyTo as Api.InputReplyToMessage).replyToMsgId, 12);
  });
});
