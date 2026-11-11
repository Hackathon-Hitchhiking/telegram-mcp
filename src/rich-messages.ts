import { createHash, randomBytes } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import bigInt from "big-integer";
import { LAYER } from "telegram/tl/AllTLObjects.js";
import { Api } from "telegram/tl/index.js";
import { compileRichMarkdown, inspectRichMessage, RICH_LIMITS, type RichInspection } from "./rich-markdown.js";

type ObjectFields = Record<string, unknown>;
type Constructor = new (args: ObjectFields) => Api.AnyRequest;

/** The installed schema is newer than GramJS's published TypeScript declarations. */
function request(name: "SendMessage" | "EditMessage" | "SaveDraft" | "GetRichMessage", args: ObjectFields) {
  const method = (Api.messages as unknown as Record<string, Constructor>)[name];
  if (!method) throw new Error(`Telegram layer ${LAYER} has no messages.${name}; install the pinned schema first.`);
  return new method(args);
}

export interface RichClient {
  invoke(request: Api.AnyRequest): Promise<unknown>;
  getInputEntity(peer: unknown): Promise<Api.TypeInputPeer>;
  getMe(): Promise<{ id?: { toString(): string }; premium?: boolean; bot?: boolean }>;
}

export interface RichContext {
  client: RichClient;
  resolvePeer(chatId: string): Promise<unknown>;
  journalDirectory: string;
  /** Space calls without replaying a write after an uncertain network outcome. */
  once<T>(fn: () => Promise<T>): Promise<T>;
}

export interface RichOptions {
  silent?: boolean;
  protectContent?: boolean;
  clearDraft?: boolean;
  replyTo?: number;
  topicId?: number;
  scheduleDate?: number;
  rtl?: boolean;
  noautolink?: boolean;
}

export interface RichPreview {
  text: string;
  tableCount: number;
  partial: boolean;
  truncated: boolean;
}

/** Ordinary history keeps a bounded labelled preview; the dedicated tool reads full cells. */
export function richPreview(message: unknown): RichPreview | undefined {
  const rich = fields(fields(message).richMessage);
  if (!Object.keys(rich).length) return undefined;
  const inspection = inspectRichMessage(rich);
  const text = [...inspection.text].slice(0, 1500).join("");
  return {
    text,
    tableCount: inspection.tableCount,
    partial: rich.part === true,
    truncated: inspection.truncated || text.length < inspection.text.length,
  };
}

export interface RichReceipt {
  requestId: string;
  chatId: string;
  operation: "send" | "edit" | "draft";
  state: "submitting" | "sent" | "edited" | "draft_saved" | "rejected" | "uncertain";
  contentHash: string;
  optionsHash: string;
  randomId: string;
  messageId?: number;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

function fields(value: unknown): ObjectFields {
  return value && typeof value === "object" ? (value as ObjectFields) : {};
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

function journalFile(directory: string, id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(
      "requestId must be a UUID v4. Reuse it when checking an uncertain operation; never blindly resend.",
    );
  }
  return join(directory, `${id.toLowerCase()}.json`);
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function durableFile(path: string, receipt: RichReceipt): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(receipt)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** A failed local checkpoint must never erase a known server acknowledgement. */
async function checkpoint(directory: string, receipt: RichReceipt): Promise<boolean> {
  try {
    await updateJournal(directory, receipt);
    return true;
  } catch {
    receipt.error = "JOURNAL_PERSIST_FAILED: preserve this receipt and do not resend.";
    return false;
  }
}

async function updateJournal(directory: string, receipt: RichReceipt): Promise<void> {
  receipt.updatedAt = new Date().toISOString();
  const path = journalFile(directory, receipt.requestId);
  const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await durableFile(temp, receipt);
    await rename(temp, path);
    await syncDirectory(directory);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

export async function readRichReceipt(directory: string, requestId: string): Promise<RichReceipt | null> {
  try {
    const receipt = JSON.parse(await readFile(journalFile(directory, requestId), "utf8")) as RichReceipt;
    if (receipt.requestId.toLowerCase() !== requestId.toLowerCase())
      throw new Error("Rich send journal identity mismatch.");
    return receipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function postingMode(result: unknown): string {
  const config = fields(fields(result).config);
  const entries = Array.isArray(config.value) ? config.value : [];
  const entry = entries.map(fields).find((item) => item.key === "rich_message_posting");
  const mode = fields(entry?.value).value;
  return typeof mode === "string" ? mode : "premium";
}

export async function getRichCapabilities(context: RichContext) {
  const me = await context.client.getMe();
  const config = await context.client.invoke(new Api.help.GetAppConfig({ hash: 0 }));
  const mode = postingMode(config);
  const premium = me.premium === true;
  return {
    layer: LAYER,
    premium,
    postingMode: mode,
    canSend: mode === "enabled" || (mode === "premium" && premium),
    compiler: "local-structured-blocks",
    formats: ["rich-markdown"],
    limits: { textCharacters: 32768, blocks: 500, nesting: 16, tableColumns: 20 },
    note: "Local compiler limits; Telegram still enforces account and chat permissions. No bot token is used.",
  };
}

function peerIdentity(peer: unknown): string | undefined {
  const p = fields(peer);
  for (const key of ["channelId", "chatId", "userId"]) {
    if (p[key] !== undefined) return `${key}:${String(p[key])}`;
  }
  return undefined;
}

export async function getRichMessage(context: RichContext, chatId: string, messageId: number) {
  if (!Number.isSafeInteger(messageId) || messageId < 1) throw new Error("messageId must be a positive integer.");
  const peer = await context.client.getInputEntity(await context.resolvePeer(chatId));
  const result = fields(await context.client.invoke(request("GetRichMessage", { peer, id: messageId })));
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const message = messages.map(fields).find((item) => item.id === messageId);
  if (!message) throw new Error(`Message ${messageId} was not returned for the requested chat.`);
  let expectedPeer = peerIdentity(peer);
  if (!expectedPeer && fields(peer).className === "InputPeerSelf") {
    const id = (await context.client.getMe()).id?.toString();
    if (id) expectedPeer = `userId:${id}`;
  }
  const actualPeer = peerIdentity(message.peerId);
  if (!expectedPeer || !actualPeer || expectedPeer !== actualPeer)
    throw new Error("Rich message peer mismatch or missing peer identity.");
  if (!message.richMessage) throw new Error(`Message ${messageId} has no native rich message.`);
  const rich = fields(message.richMessage);
  const semanticUnsupported: string[] = [];
  const semanticStructure = richSemanticStructure(rich, semanticUnsupported);
  const semanticHash = semanticStructure === undefined ? undefined : hash(semanticStructure);
  return {
    chatId,
    messageId,
    partial: rich.part === true,
    inspection: inspectRichMessage(rich),
    semanticHash,
    semanticStructure,
    semanticUnsupported,
  };
}

function sentId(result: unknown, randomId: string): number | undefined {
  const value = fields(result);
  if (value.className === "UpdateShortSentMessage" && typeof value.id === "number") return value.id;
  const updates = Array.isArray(value.updates) ? value.updates : [];
  const match = updates
    .map(fields)
    .find((item) => item.className === "UpdateMessageID" && String(item.randomId) === randomId);
  return typeof match?.id === "number" ? match.id : undefined;
}

/** Canonicalize only the compiler's supported schema, with strict traversal budgets.
 * Input-only noautolink and server webpage IDs are not echoed content semantics.
 */
export function richSemanticHash(value: unknown, diagnostics: string[] = []): string | undefined {
  const structure = richSemanticStructure(value, diagnostics);
  return structure === undefined ? undefined : hash(structure);
}

/** Bounded, normalized supported content only: constructor names, text, links and display flags.
 * Telegram can split plain text into automatic-link annotations and concatenations on readback.
 * Adjacent plain segments and concat grouping have no display meaning; explicit styles/URLs do.
 */
export function richSemanticStructure(value: unknown, diagnostics: string[] = []): unknown | undefined {
  const rich = fields(value);
  let budget = RICH_LIMITS.textLength * 3;
  let stringBudget = RICH_LIMITS.sourceBytes * 2;
  const seen = new Set<object>();
  const bools = new Set([
    "header",
    "alignCenter",
    "alignRight",
    "valignMiddle",
    "valignBottom",
    "bordered",
    "striped",
    "compact",
    "checkbox",
    "checked",
    "collapsed",
    "reversed",
  ]);
  const definitions: Record<string, string[]> = {
    TextEmpty: [],
    TextPlain: ["text"],
    TextConcat: ["texts"],
    TextUrl: ["text", "url"],
    PageBlockDivider: [],
    PageBlockParagraph: ["text"],
    PageBlockPreformatted: ["text", "language"],
    PageBlockBlockquote: ["text", "caption", "collapsed"],
    PageBlockTable: ["title", "rows", "bordered", "striped", "compact"],
    PageTableRow: ["cells"],
    PageTableCell: [
      "text",
      "header",
      "alignCenter",
      "alignRight",
      "valignMiddle",
      "valignBottom",
      "colspan",
      "rowspan",
    ],
    PageBlockList: ["items"],
    PageBlockOrderedList: ["items", "reversed", "start", "type"],
    PageListItemText: ["text", "checkbox", "checked"],
    PageListOrderedItemText: ["text", "num", "value", "type", "checkbox", "checked"],
  };
  for (const name of [
    "Bold",
    "Italic",
    "Underline",
    "Strike",
    "Fixed",
    "Spoiler",
    "Subscript",
    "Superscript",
    "Marked",
  ])
    definitions[`Text${name}`] = ["text"];
  for (let n = 1; n <= 6; n++) definitions[`PageBlockHeading${n}`] = ["text"];
  const visit = (node: unknown, depth: number): unknown => {
    if (--budget < 0 || depth > RICH_LIMITS.depth + 4) throw new Error("semantic limit");
    if (node === undefined || node === null) return null;
    if (typeof node === "string") {
      stringBudget -= node.length;
      if (node.length > RICH_LIMITS.sourceBytes || stringBudget < 0) throw new Error("semantic string limit");
      return node;
    }
    if (typeof node === "boolean" || (typeof node === "number" && Number.isFinite(node))) return node;
    if (typeof node !== "object" || seen.has(node)) throw new Error("invalid semantic node");
    seen.add(node);
    try {
      if (Array.isArray(node)) {
        if (node.length > RICH_LIMITS.textLength) throw new Error("semantic array limit");
        return node.map((item) => visit(item, depth + 1));
      }
      const object = fields(node);
      const name = String(object.className);
      // Telegram may annotate detected URLs/emails/phones/cards with wrapper-only types.
      // Unwrap those annotations while retaining every explicit TextUrl destination and style.
      // noautolink controls detection on input, but is not echoed by RichMessage on readback.
      if (["TextAutoUrl", "TextAutoEmail", "TextAutoPhone", "TextBankCard"].includes(name)) {
        return visit(object.text, depth + 1);
      }
      if (name === "TextPlain" && object.text === "") return ["TextEmpty"];
      if (name === "TextConcat") {
        if (!Array.isArray(object.texts) || object.texts.length > RICH_LIMITS.textLength) {
          throw new Error("invalid semantic concatenation");
        }
        const parts: unknown[][] = [];
        const append = (part: unknown): void => {
          if (!Array.isArray(part)) throw new Error("invalid semantic concatenation child");
          if (part[0] === "TextEmpty") return;
          if (part[0] === "TextConcat" && Array.isArray(part[1])) {
            for (const child of part[1]) append(child);
            return;
          }
          const previous = parts[parts.length - 1];
          if (previous?.[0] === "TextPlain" && part[0] === "TextPlain") {
            previous[1] = String(previous[1]) + String(part[1]);
          } else parts.push(part);
        };
        for (const child of object.texts) append(visit(child, depth + 1));
        return parts.length === 0 ? ["TextEmpty"] : parts.length === 1 ? parts[0] : ["TextConcat", parts];
      }
      const keys = definitions[name];
      if (!keys) {
        const safeName = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(name) ? name : "Unknown";
        throw new Error(`unsupported semantic constructor: ${safeName}`);
      }
      return [name, ...keys.map((key) => (bools.has(key) ? object[key] === true : visit(object[key], depth + 1)))];
    } finally {
      seen.delete(node);
    }
  };
  try {
    if (!Array.isArray(rich.blocks) || rich.blocks.length > RICH_LIMITS.blockCount) {
      diagnostics.push("invalid semantic blocks");
      return undefined;
    }
    return { rtl: rich.rtl === true, blocks: visit(rich.blocks, 0) };
  } catch (error) {
    // Only locally generated, bounded failure codes/constructor names; never message text or URLs.
    diagnostics.push(error instanceof Error ? error.message.slice(0, 128) : "semantic inspection failed");
    return undefined;
  }
}

function verifiedInspection(expected: RichInspection, actual: RichInspection): boolean {
  return (
    !actual.truncated &&
    actual.unsupported.length === 0 &&
    expected.text === actual.text &&
    JSON.stringify(expected.tables) === JSON.stringify(actual.tables)
  );
}

function errorCode(error: unknown): string {
  const name = fields(error).errorMessage;
  return typeof name === "string" && /^[A-Z][A-Z0-9_]{1,100}$/.test(name) ? name : "TRANSPORT_OR_DECODE_ERROR";
}

/** Single submission, with a durable reservation. Reusing requestId only returns its recorded state. */
export async function writeRichMessage(
  context: RichContext,
  operation: "send" | "edit" | "draft",
  chatId: string,
  requestId: string,
  markdown: string,
  options: RichOptions = {},
  messageId?: number,
): Promise<RichReceipt> {
  const compiled = compileRichMarkdown(markdown, options);
  const normalizedOptions = Object.fromEntries(
    Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .sort(),
  );
  const optionsHash = hash({ operation, messageId, options: normalizedOptions });
  const contentHash = hash(markdown);
  const existing = await readRichReceipt(context.journalDirectory, requestId);
  if (existing) {
    if (
      existing.chatId !== chatId ||
      existing.operation !== operation ||
      existing.contentHash !== contentHash ||
      existing.optionsHash !== optionsHash
    ) {
      throw new Error("requestId already belongs to another payload. Use the original payload to check its status.");
    }
    return existing;
  }
  if (
    options.scheduleDate !== undefined &&
    (!Number.isInteger(options.scheduleDate) || options.scheduleDate <= Math.floor(Date.now() / 1000))
  ) {
    throw new Error("scheduleDate must be a future Unix timestamp.");
  }
  if (operation === "edit" && (!Number.isSafeInteger(messageId) || (messageId ?? 0) < 1)) {
    throw new Error("A positive messageId is required for editing.");
  }
  const capabilities = await getRichCapabilities(context);
  if (!capabilities.canSend)
    throw new Error(
      `Rich Messages are unavailable: posting=${capabilities.postingMode}, premium=${capabilities.premium}.`,
    );
  const peer = await context.client.getInputEntity(await context.resolvePeer(chatId));
  const randomId = bigInt
    .fromArray([...randomBytes(8)], 256)
    .and(bigInt("7fffffffffffffff", 16))
    .toString();
  const timestamp = new Date().toISOString();
  const receipt: RichReceipt = {
    requestId,
    chatId,
    operation,
    contentHash,
    optionsHash,
    randomId,
    state: "submitting",
    verified: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(messageId ? { messageId } : {}),
  };
  await mkdir(context.journalDirectory, { recursive: true, mode: 0o700 });
  await syncDirectory(dirname(context.journalDirectory));
  const reservation = `${journalFile(context.journalDirectory, requestId)}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    // Publish a complete, synced reservation atomically; concurrent readers never see partial JSON.
    await durableFile(reservation, receipt);
    await link(reservation, journalFile(context.journalDirectory, requestId));
    await syncDirectory(context.journalDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // Another caller owns the same reservation. It alone may submit the write.
      const concurrent = await readRichReceipt(context.journalDirectory, requestId);
      if (
        concurrent &&
        concurrent.contentHash === contentHash &&
        concurrent.optionsHash === optionsHash &&
        concurrent.chatId === chatId
      )
        return concurrent;
      throw new Error("requestId is concurrently reserved for another payload.");
    }
    throw error;
  } finally {
    await unlink(reservation).catch(() => {});
  }
  const replyTo = options.replyTo ?? options.topicId;
  const common = {
    peer,
    richMessage: compiled.input,
    ...(replyTo
      ? {
          replyTo: new Api.InputReplyToMessage({
            replyToMsgId: replyTo,
            ...(options.topicId ? { topMsgId: options.topicId } : {}),
          }),
        }
      : {}),
  };
  try {
    const result = await context.once(() =>
      context.client.invoke(
        operation === "send"
          ? request("SendMessage", {
              ...common,
              message: "",
              randomId: bigInt(randomId),
              silent: options.silent,
              noforwards: options.protectContent,
              clearDraft: options.clearDraft,
              ...(options.scheduleDate ? { scheduleDate: options.scheduleDate } : {}),
            })
          : operation === "edit"
            ? request("EditMessage", { peer, id: messageId, richMessage: compiled.input })
            : request("SaveDraft", { ...common, message: "" }),
      ),
    );
    if (operation === "send") {
      receipt.messageId = sentId(result, randomId);
      receipt.state = receipt.messageId ? "sent" : "uncertain";
      if (!receipt.messageId)
        receipt.error = "No matching acknowledgement ID; do not resend. Reconcile chat history first.";
    } else {
      receipt.state = operation === "edit" ? "edited" : result === true ? "draft_saved" : "uncertain";
    }
  } catch (error) {
    const code = errorCode(error);
    const rpc = fields(error).code;
    receipt.state = typeof rpc === "number" && rpc >= 400 && rpc < 500 ? "rejected" : "uncertain";
    receipt.error = code;
    await checkpoint(context.journalDirectory, receipt);
    return receipt;
  }
  if (!(await checkpoint(context.journalDirectory, receipt))) return receipt;
  if (receipt.messageId && !options.scheduleDate && (receipt.state === "sent" || receipt.state === "edited")) {
    try {
      const readback = await getRichMessage(context, chatId, receipt.messageId);
      receipt.verified =
        !readback.partial &&
        verifiedInspection(compiled.inspection, readback.inspection) &&
        readback.semanticHash !== undefined &&
        readback.semanticHash === richSemanticHash(compiled.input);
      if (!receipt.verified)
        receipt.error = "Message accepted, but complete content readback did not match. Do not resend.";
      await checkpoint(context.journalDirectory, receipt);
    } catch {
      // Known message ID is preserved even if a subsequent read fails.
      receipt.error = "Message accepted; readback is unavailable. Check telegram-get-rich-message; do not resend.";
      await checkpoint(context.journalDirectory, receipt);
    }
  }
  return receipt;
}
