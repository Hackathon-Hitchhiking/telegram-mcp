import assert from "node:assert";
import { describe, it } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LAYER } from "telegram/tl/AllTLObjects.js";
import { describeApi, searchApi } from "../api-catalog.js";
import { registerApiCatalogTools } from "../tools/api-catalog.js";

describe("installed Telegram API catalog", () => {
  it("lists bounded schema methods with an honest non-invocation contract", () => {
    const result = searchApi("", "method", 3);
    assert.strictEqual(result.schemaLayer, LAYER);
    assert.strictEqual(result.entries.length, 3);
    assert.ok(result.total > 600);
    assert.strictEqual(result.nextOffset, 3);
    assert.strictEqual(result.invocation, "schema-reference-only");
    assert.ok(result.entries.every((entry) => entry.kind === "method"));
    assert.ok(!("fields" in result.entries[0]), "search does not return hundreds of field definitions");
  });

  it("finds native TL and GramJS names and paginates deterministically", () => {
    const result = searchApi("messages gethistory");
    assert.ok(result.entries.some((entry) => entry.name === "messages.getHistory"));
    const first = searchApi("messages", "method", 2);
    const second = searchApi("messages", "method", 2, 2);
    assert.strictEqual(first.total, second.total);
    assert.ok(!first.entries.some((entry) => second.entries.some((other) => other.name === entry.name)));
    assert.deepStrictEqual(describeApi("messages.getHistory"), describeApi("messages.GetHistory"));
  });

  it("describes every history parameter, including signed addOffset and native result type", () => {
    const result = describeApi("messages.getHistory");
    assert.strictEqual(result.result, "messages.Messages");
    assert.deepStrictEqual(
      result.fields.map((field) => field.name),
      ["peer", "offsetId", "offsetDate", "addOffset", "limit", "maxId", "minId", "hash"],
    );
    assert.ok(result.fields.every((field) => field.required));
    assert.strictEqual(result.constructorId, "0x4423e6c5");
  });

  it("describes optional flags and serializer-managed bits without claiming permissions", () => {
    const result = describeApi("messages.sendMessage");
    assert.strictEqual(result.fields.find((field) => field.name === "flags")?.managedByCodec, true);
    const silent = result.fields.find((field) => field.name === "silent");
    assert.strictEqual(silent?.required, false);
    assert.deepStrictEqual(silent?.flag, { name: "flags", bit: 5, sharedWith: [] });
    assert.strictEqual(result.fields.find((field) => field.name === "randomId")?.codecMayInfer, true);
    assert.strictEqual(result.invocation, "schema-reference-only");
  });

  it("includes rich-message fields supplied by the upgraded installed schema", () => {
    assert.ok(LAYER >= 233, "schema upgrade must run before the enhanced package is tested or built");
    const result = describeApi("messages.sendMessage");
    const rich = result.fields.find((field) => field.name === "richMessage");
    assert.ok(rich);
    assert.strictEqual(rich.type, "InputRichMessage");
    assert.strictEqual(rich.flag?.bit, 23);
    assert.ok(searchApi("rich_message").entries.some((entry) => entry.name === "messages.sendMessage"));
  });

  it("describes constructors and paginates wide field definitions", () => {
    const definition = describeApi("inputPeerChannel");
    assert.strictEqual(definition.kind, "constructor");
    assert.strictEqual(definition.result, "InputPeer");
    const part = describeApi("messages.sendMessage", 0, 2);
    assert.strictEqual(part.fields.length, 2);
    assert.strictEqual(part.nextFieldOffset, 2);
    const all = describeApi("messages.sendMessage");
    assert.deepStrictEqual(describeApi("messages.sendMessage", 2, 2).fields, all.fields.slice(2, 4));
  });

  it("rejects unknown names, kinds, excessive output and invalid offsets", () => {
    assert.throws(() => describeApi("messages.noSuchMethod"), /Unknown TL/);
    assert.throws(() => describeApi(""), /name/);
    assert.throws(() => describeApi("messages.sendMessage", 0, 101), /fieldLimit/);
    assert.throws(() => searchApi("", "method", 51), /limit/);
    assert.throws(() => searchApi("", "method", 20, -1), /offset/);
    assert.throws(() => searchApi("x".repeat(161)), /query/);
    assert.throws(() => searchApi("", "raw" as never), /kind/);
  });

  it("registers search and describe without requiring any Telegram service or connection", () => {
    const server = new McpServer({ name: "test", version: "0" });
    registerApiCatalogTools(server);
    const registered = (
      server as unknown as {
        _registeredTools: Record<string, { annotations: { readOnlyHint: boolean } }>;
      }
    )._registeredTools;
    assert.deepStrictEqual(Object.keys(registered).sort(), ["telegram-api-describe", "telegram-api-search"]);
    for (const tool of Object.values(registered)) assert.strictEqual(tool.annotations.readOnlyHint, true);
  });
});
