import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TelegramService } from "../telegram-client.js";
import { registerMediaTools } from "../tools/media.js";

const TOOL = "telegram-download-media";
const PDF = Buffer.from("%PDF-1.7\nsynthetic fixture\n%%EOF\n");
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);

async function setup(t: TestContext) {
  const telegram = new TelegramService(1, "fixture");
  let downloads = 0;
  const fakeMtproto = {
    getMessages: async (_peer: string, { ids: [id] }: { ids: number[] }) => {
      if (id === 2) return [{ id, media: { photo: {} } }];
      return [
        {
          id,
          media: {
            document: { size: id === 3 ? 7 * 1024 * 1024 : PDF.length, attributes: [{ fileName: "sample.pdf" }] },
          },
        },
      ];
    },
    downloadMedia: async ({ id }: { id: number }) => {
      downloads++;
      return id === 2 ? PHOTO : PDF;
    },
  };
  // Exercise the real bounded downloader and registered MCP tool without an account.
  const internals = telegram as unknown as { client: unknown; connected: boolean };
  internals.client = fakeMtproto;
  internals.connected = true;
  const server = new McpServer({ name: "telegram-test", version: "1" });
  registerMediaTools(server, telegram);
  const client = new Client({ name: "telegram-test-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    download: (messageId: number, downloadPath?: string) =>
      client.callTool({ name: TOOL, arguments: { chatId: "@example", messageId, downloadPath } }),
    downloads: () => downloads,
  };
}

test("downloads a PDF and photo through MCP with exact bytes and metadata", async (t) => {
  const { download } = await setup(t);
  const pdf = await download(1);
  const photo = await download(2);

  const resource = pdf.content[1];
  assert.equal(resource.type, "resource");
  assert.equal(resource.resource.mimeType, "application/pdf");
  assert.deepEqual(Buffer.from(resource.resource.blob, "base64"), PDF);
  const image = photo.content[1];
  assert.equal(image.type, "image");
  assert.equal(image.mimeType, "image/jpeg");
  assert.deepEqual(Buffer.from(image.data, "base64"), PHOTO);

  assert.deepEqual(pdf.structuredContent, {
    fileName: "sample.pdf",
    mimeType: "application/pdf",
    sizeBytes: PDF.length,
    sha256: createHash("sha256").update(PDF).digest("hex"),
  });
  assert.deepEqual(photo.structuredContent, {
    fileName: "telegram-2.jpg",
    mimeType: "image/jpeg",
    sizeBytes: PHOTO.length,
    sha256: createHash("sha256").update(PHOTO).digest("hex"),
  });
});

test("rejects an oversized client download before transferring the attachment", async (t) => {
  const { download, downloads } = await setup(t);
  const result = await download(3);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /exceeds 6291456 byte limit/);
  assert.equal(downloads(), 0);
});

test("explicit paths are checked on the MCP server before downloading and never overwrite", async (t) => {
  const { download, downloads } = await setup(t);
  const dir = await mkdtemp(join(tmpdir(), "telegram-download-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const missing = await download(1, join(dir, "missing", "sample.pdf"));
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /MCP server: Folder does not exist/);
  assert.equal(downloads(), 0);

  const requested = join(dir, "sample.pdf");
  await writeFile(requested, "keep me");
  const saved = await download(1, requested);
  assert.equal(saved.isError, undefined);
  assert.match(saved.content[0].text, /saved on the MCP server.*sample \(1\)\.pdf/);
  assert.equal(await readFile(requested, "utf8"), "keep me");
  assert.deepEqual(await readFile(join(dir, "sample (1).pdf")), PDF);
});
