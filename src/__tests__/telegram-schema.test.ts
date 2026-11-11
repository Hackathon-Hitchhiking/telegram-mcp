import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { inspectTelegramSchema, readTelegramSchema, upgradeTelegramSchema } from "../../scripts/telegram-schema.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = join(root, "src/__tests__/fixtures/telegram-schema");
const vendorRoot = join(root, "vendor/telegram-schema");
const original = JSON.parse(
  gunzipSync(readFileSync(join(fixtureRoot, "gramjs-2.26.22-source.json.gz"))).toString("utf8"),
);
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "telegram-schema-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const packageRoot = join(directory, "telegram");
  cpSync(dirname(require.resolve("telegram/package.json")), packageRoot, { recursive: true });
  // Resolve unchanged dependencies from the real install, while loading the complete
  // isolated Telegram package (including its own Api/registry/BinaryReader) by path.
  symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "junction");
  writeFileSync(join(packageRoot, "tl/apiTl.js"), original.apiTl);
  writeFileSync(join(packageRoot, "tl/AllTLObjects.js"), original.allTlObjects);
  return { directory, packageRoot, options: { telegramPackageRoot: packageRoot, vendorRoot } };
}

describe("pinned Telegram layer 233 schema installer", () => {
  it("pins exact official source and license bytes, normalizing only primitive declarations", () => {
    const { provenance, schema, normalized } = readTelegramSchema();
    assert.equal(provenance.commit, "c8828d50f5eac2fc7089ce1089d7ce9095c61b5e");
    assert.equal(sha256(schema), "89bf71464239646c233f0a2a3d77512c9be08e4a63eab362afba0b721f69a26d");
    assert.equal(sha256(readFileSync(join(vendorRoot, "LICENSE"))), provenance.licenseSha256);
    assert.match(schema, /^int \? = Int;/);
    assert.doesNotMatch(normalized, /^int \? = Int;/m);
    assert.match(normalized, /inputRichMessage#e4c449fc/);
    assert.match(normalized, /rich_message:flags2\.13\?RichMessage/);
    assert.match(normalized, /rich_message:flags\.23\?InputRichMessage/);
  });

  it("updates exactly the two schema files and is idempotent", (t) => {
    const { packageRoot, options } = fixture(t);
    const transportBefore = readFileSync(join(packageRoot, "tl/schemaTl.js"));
    const implementationBefore = readFileSync(join(packageRoot, "tl/api.js"));
    const inspected = inspectTelegramSchema(options);
    assert.equal(inspected.changedFiles.length, 2);
    assert.match(readFileSync(join(packageRoot, "tl/AllTLObjects.js"), "utf8"), /LAYER = 198/);

    const first = upgradeTelegramSchema(options);
    assert.equal(first.layer, 233);
    assert.equal(first.changedFiles.length, 2);
    assert.deepEqual(upgradeTelegramSchema(options).changedFiles, []);
    assert.deepEqual(inspectTelegramSchema(options).changedFiles, []);
    assert.deepEqual(readFileSync(join(packageRoot, "tl/schemaTl.js")), transportBefore);
    assert.deepEqual(readFileSync(join(packageRoot, "tl/api.js")), implementationBefore);
  });

  it("rejects an unsupported dependency version before writing", (t) => {
    const { packageRoot, options } = fixture(t);
    const packagePath = join(packageRoot, "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    writeFileSync(packagePath, JSON.stringify({ ...pkg, version: "2.27.0" }));
    assert.throws(() => upgradeTelegramSchema(options), /Expected telegram@2\.26\.22/);
    assert.equal(readFileSync(join(packageRoot, "tl/apiTl.js"), "utf8"), original.apiTl);
    assert.equal(readFileSync(join(packageRoot, "tl/AllTLObjects.js"), "utf8"), original.allTlObjects);
  });

  it("rejects unrelated dependency edits before making partial changes", (t) => {
    const { packageRoot, options } = fixture(t);
    writeFileSync(join(packageRoot, "tl/AllTLObjects.js"), `${original.allTlObjects}\n// unrelated edit\n`);
    assert.throws(() => upgradeTelegramSchema(options), /AllTLObjects\.js differs/);
    assert.equal(readFileSync(join(packageRoot, "tl/apiTl.js"), "utf8"), original.apiTl);
  });

  it("rejects modified API source instead of overwriting a different patch", (t) => {
    const { packageRoot, options } = fixture(t);
    writeFileSync(join(packageRoot, "tl/apiTl.js"), `${original.apiTl}\n// a different patch\n`);
    assert.throws(() => upgradeTelegramSchema(options), /apiTl\.js differs/);
    assert.equal(readFileSync(join(packageRoot, "tl/AllTLObjects.js"), "utf8"), original.allTlObjects);
  });

  it("rejects an altered vendored schema by checksum", (t) => {
    const { directory, packageRoot } = fixture(t);
    const copiedVendor = join(directory, "vendor");
    cpSync(vendorRoot, copiedVendor, { recursive: true });
    writeFileSync(join(copiedVendor, "telegram_api.tl"), "bad schema\n");
    assert.throws(
      () => upgradeTelegramSchema({ telegramPackageRoot: packageRoot, vendorRoot: copiedVendor }),
      /schema checksum/,
    );
    assert.equal(readFileSync(join(packageRoot, "tl/apiTl.js"), "utf8"), original.apiTl);
  });

  it("rejects a symlinked schema target", (t) => {
    const { directory, packageRoot, options } = fixture(t);
    const target = join(directory, "unexpected.js");
    writeFileSync(target, original.apiTl);
    rmSync(join(packageRoot, "tl/apiTl.js"));
    symlinkSync(target, join(packageRoot, "tl/apiTl.js"));
    assert.throws(() => upgradeTelegramSchema(options), /regular schema dependency file/);
    assert.equal(readFileSync(target, "utf8"), original.apiTl);
  });

  it("compiles all layer 233 classes and round-trips rich table request/response fixtures", (t) => {
    const { packageRoot, options } = fixture(t);
    upgradeTelegramSchema(options);
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const { Api } = require(process.argv[1] + '/tl/index.js');
      const { LAYER, tlobjects } = require(process.argv[1] + '/tl/AllTLObjects.js');
      const { BinaryReader } = require(process.argv[1] + '/extensions/BinaryReader.js');
      const { parseTl } = require(process.argv[1] + '/tl/generationHelpers.js');
      const schema = require(process.argv[1] + '/tl/apiTl.js');
      const bigInt = require('big-integer');
      const golden = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
      const definitions = [...parseTl(schema, LAYER)];
      assert.equal(LAYER, 233);
      assert.equal(definitions.length, 2612);
      assert.equal(definitions.filter(d => d.isFunction).length, 873);
      assert.equal(typeof Api.InputRichMessage, 'function');
      assert.equal(typeof Api.messages.GetRichMessage, 'function');
      assert.equal(tlobjects[0x7600b9d3], Api.Message);
      const table = new Api.PageBlockTable({
        bordered: true, striped: true, title: new Api.TextPlain({ text: '' }),
        rows: [new Api.PageTableRow({ cells: [
          new Api.PageTableCell({ header: true, text: new Api.TextPlain({ text: 'Name' }) }),
          new Api.PageTableCell({ header: true, text: new Api.TextPlain({ text: 'Price' }) })
        ] })]
      });
      const send = new Api.messages.SendMessage({
        peer: new Api.InputPeerSelf(), message: '', randomId: bigInt(1),
        richMessage: new Api.InputRichMessage({ blocks: [table] })
      });
      assert.equal(send.getBytes().toString('hex'), golden.sendMessageHex);
      const decodedSend = new BinaryReader(send.getBytes()).tgReadObject();
      assert.ok(decodedSend instanceof Api.messages.SendMessage);
      assert.ok(decodedSend.richMessage.blocks[0] instanceof Api.PageBlockTable);
      const updateReader = new BinaryReader(Buffer.from(golden.updatesHex, 'hex'));
      const updates = send.readResult(updateReader);
      assert.ok(updates instanceof Api.Updates);
      const message = updates.updates[0].message;
      assert.ok(message instanceof Api.Message);
      assert.equal(typeof message.getSender, 'function');
      assert.equal(message.id, 42);
      assert.ok(message.richMessage instanceof Api.RichMessage);
      assert.equal(message.richMessage.part, false);
      assert.equal(message.richMessage.blocks[0].rows[0].cells[1].text.text, 'Price');
      assert.equal(updates.getBytes().toString('hex'), golden.updatesHex);
      const read = new Api.messages.GetRichMessage({ peer: new Api.InputPeerSelf(), id: 42 });
      const full = read.readResult(new BinaryReader(Buffer.from(golden.messagesHex, 'hex')));
      assert.ok(full instanceof Api.messages.Messages);
      assert.ok(full.messages[0] instanceof Api.Message);
      assert.equal(full.messages[0].richMessage.blocks[0].rows[0].cells[0].text.text, 'Name');
      assert.equal(full.getBytes().toString('hex'), golden.messagesHex);
      console.log(JSON.stringify({ layer: LAYER, definitions: definitions.length, methods: 873, offline: true }));
    `,
        packageRoot,
        join(fixtureRoot, "rich-table-layer233.json"),
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), { layer: 233, definitions: 2612, methods: 873, offline: true });
  });
});
