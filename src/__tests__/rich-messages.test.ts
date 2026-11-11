import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import bigInt from "big-integer";
import { Api } from "telegram/tl/index.js";
import { compileRichMarkdown } from "../rich-markdown.js";
import {
  getRichCapabilities,
  getRichMessage,
  type RichContext,
  readRichReceipt,
  richSemanticHash,
  richSemanticStructure,
  writeRichMessage,
} from "../rich-messages.js";

const markdown = "| Stay | Price |\n| --- | --- |\n| Riad | $90 |";
const peer = new Api.InputPeerChannel({ channelId: bigInt(42), accessHash: bigInt(99) });
const returnedPeer = new Api.PeerChannel({ channelId: bigInt(42) });
type Fields = Record<string, unknown>;
function f(value: unknown): Fields {
  return value as Fields;
}
function config(mode: string) {
  return { config: { value: [{ key: "rich_message_posting", value: { value: mode } }] } };
}

async function fixture(
  run: (context: RichContext, calls: Fields[]) => Promise<void>,
  options: {
    mode?: string;
    premium?: boolean;
    write?: (request: Fields) => unknown | Promise<unknown>;
    read?: (request: Fields) => unknown;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "telegram-rich-test-"));
  const calls: Fields[] = [];
  const context: RichContext = {
    journalDirectory: directory,
    resolvePeer: async () => peer,
    once: async (fn) => fn(),
    client: {
      getInputEntity: async () => peer,
      getMe: async () => ({ premium: options.premium ?? true }),
      invoke: async (raw) => {
        const request = f(raw);
        calls.push(request);
        if (raw instanceof Api.help.GetAppConfig) return config(options.mode ?? "premium");
        if (request.className === "messages.GetRichMessage") {
          return (
            options.read?.(request) ?? {
              messages: [{ id: request.id, peerId: returnedPeer, richMessage: compileRichMarkdown(markdown).input }],
            }
          );
        }
        return options.write
          ? options.write(request)
          : { updates: [{ className: "UpdateMessageID", randomId: request.randomId, id: 123 }] };
      },
    },
  };
  try {
    await run(context, calls);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function writes(calls: Fields[]) {
  return calls.filter((call) =>
    ["messages.SendMessage", "messages.EditMessage", "messages.SaveDraft"].includes(String(call.className)),
  );
}

describe("durable native rich writes", () => {
  it("sends an actual native table with empty ordinary text and verifies exact readback", async () => {
    await fixture(async (context, calls) => {
      const requestId = randomUUID();
      const receipt = await writeRichMessage(context, "send", "42", requestId, markdown, {
        silent: true,
        protectContent: true,
        clearDraft: true,
        replyTo: 9,
        topicId: 5,
      });
      assert.equal(receipt.state, "sent");
      assert.equal(receipt.messageId, 123);
      assert.equal(receipt.verified, true);
      const sent = writes(calls)[0];
      const bytes = (sent as unknown as Api.messages.SendMessage).getBytes();
      assert.equal(bytes.readUInt32LE(0), 0xfef48f62);
      assert.ok(bytes.readUInt32LE(4) & (1 << 23));
      assert.equal(sent.message, "");
      assert.equal(f(sent.richMessage).className, "InputRichMessage");
      assert.ok((f(sent.richMessage).blocks as Fields[]).some((block) => block.className === "PageBlockTable"));
      assert.equal(sent.silent, true);
      assert.equal(sent.noforwards, true);
      assert.equal(sent.clearDraft, true);
      assert.equal(f(sent.replyTo).replyToMsgId, 9);
      assert.equal(f(sent.replyTo).topMsgId, 5);
      const disk = JSON.parse(await readFile(join(context.journalDirectory, `${requestId}.json`), "utf8"));
      assert.equal(disk.randomId, String(sent.randomId));
      assert.equal(disk.verified, true);
      assert.equal((await stat(join(context.journalDirectory, `${requestId}.json`))).mode & 0o777, 0o600);
      assert.deepEqual(await readRichReceipt(context.journalDirectory, requestId), receipt);
    });
  });

  it("returns the durable receipt on replay and rejects changed payload, chat, operation and flags", async () => {
    await fixture(async (context, calls) => {
      const id = randomUUID();
      const first = await writeRichMessage(context, "send", "42", id, markdown);
      assert.deepEqual(await writeRichMessage(context, "send", "42", id, markdown), first);
      await assert.rejects(writeRichMessage(context, "send", "42", id, "changed"), /another payload/);
      await assert.rejects(writeRichMessage(context, "send", "43", id, markdown), /another payload/);
      await assert.rejects(writeRichMessage(context, "draft", "42", id, markdown), /another payload/);
      await assert.rejects(writeRichMessage(context, "send", "42", id, markdown, { silent: true }), /another payload/);
      assert.equal(writes(calls).length, 1);
    });
  });

  it("reserves a concurrent request before submission so only one write reaches Telegram", async () => {
    await fixture(async (context, calls) => {
      const id = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => writeRichMessage(context, "send", "42", id, markdown)),
      );
      assert.equal(writes(calls).length, 1);
      assert.ok(results.every((result) => result.randomId === results[0].randomId));
      assert.equal((await readRichReceipt(context.journalDirectory, id))?.state, "sent");
    });
  });

  it("does not resend after transport uncertainty or a definite RPC rejection", async () => {
    for (const error of [new Error("socket closed after send"), { code: 403, errorMessage: "CHAT_WRITE_FORBIDDEN" }]) {
      await fixture(
        async (context, calls) => {
          const id = randomUUID();
          const receipt = await writeRichMessage(context, "send", "42", id, markdown);
          assert.equal(receipt.state, "code" in error ? "rejected" : "uncertain");
          assert.equal(receipt.verified, false);
          assert.deepEqual(await writeRichMessage(context, "send", "42", id, markdown), receipt);
          assert.equal(writes(calls).length, 1);
        },
        {
          write: () => {
            throw error;
          },
        },
      );
    }
  });

  it("matches UpdateMessageID by randomId, ignoring unrelated message IDs", async () => {
    await fixture(
      async (context) => {
        const receipt = await writeRichMessage(context, "send", "42", randomUUID(), markdown);
        assert.equal(receipt.messageId, 123);
        assert.equal(receipt.verified, true);
      },
      {
        write: (request) => ({
          updates: [
            { className: "UpdateMessageID", randomId: bigInt(String(request.randomId)).add(1), id: 666 },
            { className: "UpdateNewMessage", message: { id: 777 } },
            { className: "UpdateMessageID", randomId: request.randomId, id: 123 },
          ],
        }),
      },
    );
    await fixture(
      async (context, calls) => {
        const receipt = await writeRichMessage(context, "send", "42", randomUUID(), markdown);
        assert.equal(receipt.state, "uncertain");
        assert.equal(receipt.messageId, undefined);
        assert.equal(calls.filter((call) => call.className === "messages.GetRichMessage").length, 0);
      },
      { write: () => ({ updates: [{ className: "UpdateMessageID", randomId: bigInt(-1), id: 666 }] }) },
    );
  });

  it("preserves an accepted scheduled ID without pretending a history readback verified delivery", async () => {
    await fixture(async (context, calls) => {
      const date = Math.floor(Date.now() / 1000) + 3600;
      const receipt = await writeRichMessage(context, "send", "42", randomUUID(), markdown, { scheduleDate: date });
      assert.equal(receipt.messageId, 123);
      assert.equal(receipt.verified, false);
      assert.equal(writes(calls)[0].scheduleDate, date);
      assert.equal(calls.filter((call) => call.className === "messages.GetRichMessage").length, 0);
    });
  });

  it("edits and saves drafts using native rich fields without sending a fallback message", async () => {
    await fixture(
      async (context, calls) => {
        const edit = await writeRichMessage(context, "edit", "42", randomUUID(), markdown, {}, 123);
        assert.equal(edit.state, "edited");
        assert.equal(edit.verified, true);
        const draft = await writeRichMessage(context, "draft", "42", randomUUID(), markdown, { replyTo: 7 });
        assert.equal(draft.state, "draft_saved");
        assert.equal(draft.verified, false);
        const [edited, saved] = writes(calls);
        const editBytes = (edited as unknown as Api.messages.EditMessage).getBytes();
        const draftBytes = (saved as unknown as Api.messages.SaveDraft).getBytes();
        assert.equal(editBytes.readUInt32LE(0), 0xb106e66c);
        assert.ok(editBytes.readUInt32LE(4) & (1 << 23));
        assert.equal(editBytes.readUInt32LE(4) & (1 << 11), 0);
        assert.equal(draftBytes.readUInt32LE(0), 0xad0fa15c);
        assert.ok(draftBytes.readUInt32LE(4) & (1 << 9));
        assert.equal(edited.className, "messages.EditMessage");
        assert.equal(edited.id, 123);
        assert.equal(f(edited.richMessage).className, "InputRichMessage");
        assert.equal(saved.className, "messages.SaveDraft");
        assert.equal(saved.message, "");
        assert.equal(f(saved.richMessage).className, "InputRichMessage");
        assert.equal(f(saved.replyTo).replyToMsgId, 7);
        assert.equal(writes(calls).length, 2);
      },
      { write: () => true },
    );
  });

  it("rejects readback with altered links, styles, block types, table flags, alignment, tasks or direction", async () => {
    const cases = [
      ["[hotel](https://hotel.example)", "[hotel](https://wrong-hotel.example)"],
      ["**hotel**", "*hotel*"],
      ["# hotel", "## hotel"],
      ["- [x] hotel", "- [ ] hotel"],
    ];
    for (const [source, changed] of cases) {
      await fixture(
        async (context) => {
          const result = await writeRichMessage(context, "send", "42", randomUUID(), source);
          assert.equal(result.state, "sent");
          assert.equal(result.verified, false);
          assert.match(result.error ?? "", /did not match/);
        },
        {
          read: () => ({
            messages: [{ id: 123, peerId: returnedPeer, richMessage: compileRichMarkdown(changed).input }],
          }),
        },
      );
    }
    for (const change of [
      (rich: Fields) => {
        f((rich.blocks as unknown[])[0]).striped = false;
      },
      (rich: Fields) => {
        const table = f((rich.blocks as unknown[])[0]);
        const row = f((table.rows as unknown[])[0]);
        f((row.cells as unknown[])[0]).alignRight = true;
      },
      (rich: Fields) => {
        rich.rtl = true;
      },
    ]) {
      const rich = compileRichMarkdown(markdown).input;
      change(rich);
      await fixture(
        async (context) => {
          const result = await writeRichMessage(context, "send", "42", randomUUID(), markdown);
          assert.equal(result.messageId, 123);
          assert.equal(result.verified, false);
        },
        { read: () => ({ messages: [{ id: 123, peerId: returnedPeer, richMessage: rich }] }) },
      );
    }
  });

  it("preserves the acknowledged ID and state when journal persistence fails after sending", async () => {
    await fixture(async (context, calls) => {
      const originalInvoke = context.client.invoke;
      context.client.invoke = async (raw) => {
        if (f(raw).className === "messages.SendMessage") {
          const id = String(f(raw).randomId);
          // The durable reservation is complete before the network write begins.
          const files = await import("node:fs/promises").then((fs) => fs.readdir(context.journalDirectory));
          const reservation = JSON.parse(
            await readFile(
              join(context.journalDirectory, files.find((file) => file.endsWith(".json")) ?? "missing"),
              "utf8",
            ),
          );
          assert.equal(reservation.state, "submitting");
          assert.equal(reservation.randomId, id);
          await rm(context.journalDirectory, { recursive: true });
          await writeFile(context.journalDirectory, "unavailable");
          calls.push(f(raw));
          return { updates: [{ className: "UpdateMessageID", randomId: f(raw).randomId, id: 42 }] };
        }
        return originalInvoke(raw);
      };
      const receipt = await writeRichMessage(context, "send", "42", randomUUID(), markdown);
      assert.equal(receipt.state, "sent");
      assert.equal(receipt.messageId, 42);
      assert.equal(receipt.verified, false);
      assert.match(receipt.error ?? "", /JOURNAL_PERSIST_FAILED/);
      assert.equal(writes(calls).length, 1);
    });
  });

  it("replays a scheduled receipt after the original scheduled timestamp has passed", async (t) => {
    await fixture(async (context, calls) => {
      const id = randomUUID();
      const date = Math.floor(Date.now() / 1000) + 3600;
      const receipt = await writeRichMessage(context, "send", "42", id, markdown, { scheduleDate: date });
      t.mock.method(Date, "now", () => (date + 1) * 1000);
      try {
        assert.deepEqual(await writeRichMessage(context, "send", "42", id, markdown, { scheduleDate: date }), receipt);
        assert.equal(writes(calls).length, 1);
      } finally {
        t.mock.restoreAll();
      }
    });
  });

  it("keeps the known accepted ID when readback is unavailable, partial or different", async () => {
    for (const read of [
      () => {
        throw new Error("offline");
      },
      () => ({
        messages: [
          { id: 123, peerId: returnedPeer, richMessage: { ...compileRichMarkdown(markdown).input, part: true } },
        ],
      }),
      () => ({ messages: [{ id: 123, peerId: returnedPeer, richMessage: compileRichMarkdown("different").input }] }),
    ]) {
      await fixture(
        async (context, calls) => {
          const result = await writeRichMessage(context, "send", "42", randomUUID(), markdown);
          assert.equal(result.messageId, 123);
          assert.equal(result.state, "sent");
          assert.equal(result.verified, false);
          assert.match(result.error ?? "", /readback/);
          assert.equal(writes(calls).length, 1);
        },
        { read },
      );
    }
  });
});

describe("rich capabilities and exact readback", () => {
  it("checks the server posting mode and Premium before writing", async () => {
    for (const [mode, premium, expected] of [
      ["enabled", false, true],
      ["premium", true, true],
      ["premium", false, false],
      ["disabled", true, false],
    ] as const) {
      await fixture(
        async (context, calls) => {
          const capabilities = await getRichCapabilities(context);
          assert.equal(capabilities.canSend, expected);
          assert.equal(capabilities.postingMode, mode);
          assert.ok(calls[0] instanceof Api.help.GetAppConfig);
          assert.equal(calls[0].hash, 0);
          if (!expected) {
            await assert.rejects(writeRichMessage(context, "send", "42", randomUUID(), markdown), /unavailable/);
            assert.equal(writes(calls).length, 0);
          }
        },
        { mode, premium },
      );
    }
  });

  it("resolves Saved Messages identity once and accepts decoded false flags", async () => {
    await fixture(
      async (context) => {
        let meCalls = 0;
        context.client.getInputEntity = async () => new Api.InputPeerSelf();
        context.client.getMe = async () => {
          meCalls++;
          return { id: bigInt(777), premium: true };
        };
        const result = await getRichMessage(context, "me", 123);
        assert.equal(result.messageId, 123);
        assert.equal(meCalls, 1);
        assert.equal(typeof result.semanticHash, "string");
      },
      {
        read: () => ({
          messages: [
            {
              id: 123,
              peerId: new Api.PeerUser({ userId: bigInt(777) }),
              richMessage: compileRichMarkdown(markdown).input,
            },
          ],
        }),
      },
    );
  });

  it("normalizes only server automatic wrappers while retaining styles and explicit link destinations", async () => {
    const source = "**Trip.com** and [hotel](https://hotel.example)";
    const expected = compileRichMarkdown(source).input;
    for (const className of ["TextAutoUrl", "TextAutoEmail", "TextAutoPhone", "TextBankCard"]) {
      const actual = compileRichMarkdown(source).input;
      const paragraph = f((actual.blocks as unknown[])[0]);
      const concat = f(paragraph.text);
      const bold = f((concat.texts as unknown[])[0]);
      bold.text = { className, text: bold.text };
      assert.equal(richSemanticHash(actual), richSemanticHash(expected));
      await fixture(
        async (context) => {
          const receipt = await writeRichMessage(context, "send", "42", randomUUID(), source);
          assert.equal(receipt.verified, true);
        },
        { read: () => ({ messages: [{ id: 123, peerId: returnedPeer, richMessage: actual }] }) },
      );
      const explicit = f((concat.texts as unknown[])[2]);
      assert.equal(explicit.className, "TextUrl");
      explicit.url = "https://wrong-hotel.example";
      assert.notEqual(richSemanticHash(actual), richSemanticHash(expected));
      await fixture(
        async (context) => {
          const receipt = await writeRichMessage(context, "send", "42", randomUUID(), source);
          assert.equal(receipt.verified, false);
        },
        { read: () => ({ messages: [{ id: 123, peerId: returnedPeer, richMessage: actual }] }) },
      );
    }
  });

  it("coalesces server-segmented automatic links and nested concatenations while retaining explicit semantics", async () => {
    const source = "Find Trip.com deals and compare.";
    const expected = compileRichMarkdown(source).input;
    const actual = compileRichMarkdown(source).input;
    f((actual.blocks as unknown[])[0]).text = {
      className: "TextConcat",
      texts: [
        { className: "TextPlain", text: "Find " },
        {
          className: "TextConcat",
          texts: [
            { className: "TextEmpty" },
            { className: "TextAutoUrl", text: { className: "TextPlain", text: "Trip.com" } },
            { className: "TextPlain", text: " deals" },
          ],
        },
        { className: "TextPlain", text: " and compare." },
        { className: "TextPlain", text: "" },
      ],
    };
    assert.deepEqual(richSemanticStructure(actual), richSemanticStructure(expected));
    await fixture(
      async (context) => {
        const read = await getRichMessage(context, "42", 123);
        assert.deepEqual(read.semanticStructure, richSemanticStructure(expected));
        const receipt = await writeRichMessage(context, "send", "42", randomUUID(), source);
        assert.equal(receipt.verified, true);
      },
      { read: () => ({ messages: [{ id: 123, peerId: returnedPeer, richMessage: actual }] }) },
    );
    const paragraph = f((actual.blocks as unknown[])[0]);
    paragraph.text = { className: "TextUrl", text: paragraph.text, url: "https://wrong.example" };
    assert.notEqual(richSemanticHash(actual), richSemanticHash(expected));
    paragraph.text = { className: "TextBold", text: f(paragraph.text).text };
    assert.notEqual(richSemanticHash(actual), richSemanticHash(expected));
  });

  it("reports a bounded unsupported semantic constructor without leaking its content", async () => {
    const rich = {
      blocks: [
        {
          className: "PageBlockThinking",
          text: { className: "TextPlain", text: "private body https://private.example" },
        },
      ],
    };
    await fixture(
      async (context) => {
        const result = await getRichMessage(context, "42", 123);
        assert.equal(result.semanticHash, undefined);
        assert.deepEqual(result.semanticUnsupported, ["unsupported semantic constructor: PageBlockThinking"]);
        assert.ok(!JSON.stringify(result.semanticUnsupported).includes("private"));
      },
      { read: () => ({ messages: [{ id: 123, peerId: returnedPeer, richMessage: rich }] }) },
    );
  });

  it("refuses a different message ID, foreign chat or absent peer", async () => {
    for (const message of [
      { id: 124, peerId: returnedPeer },
      { id: 123, peerId: new Api.PeerChannel({ channelId: bigInt(99) }) },
      { id: 123 },
    ]) {
      await fixture(
        async (context) => {
          await assert.rejects(getRichMessage(context, "42", 123), /not returned|peer/i);
        },
        { read: () => ({ messages: [{ ...message, richMessage: compileRichMarkdown(markdown).input }] }) },
      );
    }
  });
});
