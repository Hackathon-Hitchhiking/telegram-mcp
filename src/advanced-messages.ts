import bigInt from "big-integer";
import { Api } from "telegram/tl/index.js";
import { peerToCompact, summarizeQuickReplyMessage } from "./telegram-helpers.js";
import { sanitize } from "./tools/shared.js";

const MAX_IDS = 100;
const MAX_TEXT_CHARACTERS = 20_000;
const MAX_MESSAGE_TEXT = 4_000;
const MAX_INT = 2_147_483_647;

export interface AdvancedMessagesContext {
  client: {
    invoke(request: Api.AnyRequest): Promise<unknown>;
    getInputEntity(peer: unknown): Promise<Api.TypeInputPeer>;
    getMe?(): Promise<{ id: { toString(): string } }>;
  };
  resolvePeer(chatId: string): Promise<unknown>;
}

export interface HistoryPageOptions {
  limit?: number;
  offsetId?: number;
  offsetDate?: number;
  addOffset?: number;
  maxId?: number;
  minId?: number;
}

export const SENT_MEDIA_FILTERS = ["photo", "video", "photoVideo", "document", "music", "voice", "gif"] as const;
export type SentMediaFilter = (typeof SENT_MEDIA_FILTERS)[number];

type MessageContainer = Api.messages.TypeMessages;
type MessageSummary = NonNullable<ReturnType<typeof summarizeQuickReplyMessage>> & {
  peer?: ReturnType<typeof peerToCompact>;
  textTruncated?: boolean;
  richMessage?: { present: true; partial: boolean };
};

/** A bounded, labelled projection. Chat/user vectors and access hashes are never returned. */
export interface AdvancedMessagePage {
  messages: MessageSummary[];
  count?: number;
  textTruncated: boolean;
  coverage: string;
}

function integer(name: string, value: number, min = 0, max = MAX_INT): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function limitValue(value = 20): number {
  return integer("limit", value, 1, 100);
}

function messageIds(ids: number[]): number[] {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS) {
    throw new Error("messageIds must contain 1–100 message IDs");
  }
  for (const id of ids) integer("messageId", id, 1);
  if (new Set(ids).size !== ids.length) throw new Error("messageIds must not contain duplicates");
  return ids;
}

function rawMessages(result: unknown): Api.TypeMessage[] {
  if (!result || typeof result !== "object" || !("messages" in result)) {
    throw new Error("Telegram returned no messages array");
  }
  const messages = (result as { messages: unknown }).messages;
  if (!Array.isArray(messages)) throw new Error("Telegram returned no messages array");
  return messages;
}

function countOf(result: unknown): number | undefined {
  if (!result || typeof result !== "object" || !("count" in result)) return undefined;
  const count = (result as { count: unknown }).count;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function summarize(messages: Api.TypeMessage[], result: unknown, coverage: string): AdvancedMessagePage {
  let budget = MAX_TEXT_CHARACTERS;
  let textTruncated = false;
  const summaries: MessageSummary[] = [];
  for (const message of messages) {
    const summary = summarizeQuickReplyMessage(message);
    if (!summary) continue;
    const sourceText = sanitize(summary.text);
    const text = sanitize(sourceText.slice(0, Math.min(MAX_MESSAGE_TEXT, budget)));
    budget -= text.length;
    const truncated = text.length < sourceText.length;
    textTruncated ||= truncated;
    const base = message as Api.Message | Api.MessageService;
    const rich = (message as unknown as { richMessage?: { part?: boolean } }).richMessage;
    // The webpage projection can carry another large body; only expose its metadata here.
    const { webpage, ...rest } = summary;
    summaries.push({
      ...rest,
      text,
      peer: peerToCompact(base.peerId),
      ...(truncated ? { textTruncated: true } : {}),
      ...(webpage
        ? { webpage: { title: webpage.title ? sanitize(sanitize(webpage.title).slice(0, 512)) : undefined } }
        : {}),
      ...(rich ? { richMessage: { present: true, partial: rich.part === true } } : {}),
    });
  }
  return { messages: summaries, count: countOf(result), textTruncated, coverage };
}

async function resolveInputPeer(context: AdvancedMessagesContext, chatId: string): Promise<Api.TypeInputPeer> {
  if (typeof chatId !== "string" || !chatId.trim() || chatId.length > 256) {
    throw new Error("chatId must contain 1–256 characters");
  }
  return context.client.getInputEntity(await context.resolvePeer(chatId));
}

async function peerIdentity(
  context: AdvancedMessagesContext,
  input: Api.TypeInputPeer,
): Promise<{ kind: "user" | "chat" | "channel"; id: string }> {
  if (input instanceof Api.InputPeerChannel || input instanceof Api.InputPeerChannelFromMessage) {
    return { kind: "channel", id: input.channelId.toString() };
  }
  if (input instanceof Api.InputPeerChat) return { kind: "chat", id: input.chatId.toString() };
  if (input instanceof Api.InputPeerUser || input instanceof Api.InputPeerUserFromMessage) {
    return { kind: "user", id: input.userId.toString() };
  }
  if (input instanceof Api.InputPeerSelf && context.client.getMe) {
    return { kind: "user", id: (await context.client.getMe()).id.toString() };
  }
  throw new Error("chatId did not resolve to an accessible user, group or channel");
}

function belongsToPeer(message: Api.TypeMessage, peer: { kind: string; id: string }): boolean {
  const actual = peerToCompact((message as Api.Message | Api.MessageService).peerId);
  return actual?.kind === peer.kind && actual.id === peer.id;
}

/** https://core.telegram.org/method/messages.getMessages and channels.getMessages */
export async function getMessagesByIds(context: AdvancedMessagesContext, chatId: string, ids: number[]) {
  const requestedIds = messageIds(ids);
  const input = await resolveInputPeer(context, chatId);
  const peer = await peerIdentity(context, input);
  const id = requestedIds.map((value) => new Api.InputMessageID({ id: value }));
  const request =
    peer.kind === "channel"
      ? new Api.channels.GetMessages({
          channel:
            input instanceof Api.InputPeerChannelFromMessage
              ? new Api.InputChannelFromMessage({ peer: input.peer, msgId: input.msgId, channelId: input.channelId })
              : new Api.InputChannel({
                  channelId: (input as Api.InputPeerChannel).channelId,
                  accessHash: (input as Api.InputPeerChannel).accessHash,
                }),
          id,
        })
      : new Api.messages.GetMessages({ id });
  const result = await context.client.invoke(request);
  // Non-channel GetMessages is account-global. Never return an ID belonging to another chat.
  const inScope = rawMessages(result).filter((message) => belongsToPeer(message, peer));
  const byId = new Map(inScope.map((message) => [message.id, message]));
  const ordered = requestedIds.flatMap((value) => (byId.has(value) ? [byId.get(value) as Api.TypeMessage] : []));
  const page = summarize(ordered, result, "Only requested IDs matching the exact resolved chat; no read receipts.");
  return {
    ...page,
    requestedIds,
    notReturnedIds: requestedIds.filter((value) => !byId.has(value)),
    notReturnedMeaning: "Missing, inaccessible or outside the requested chat; not proof of deletion.",
  };
}

/** https://core.telegram.org/method/messages.getHistory — native order is newest first. */
export async function getHistoryPage(
  context: AdvancedMessagesContext,
  chatId: string,
  options: HistoryPageOptions = {},
) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("options must be an object");
  const allowedFields = new Set(["limit", "offsetId", "offsetDate", "addOffset", "maxId", "minId"]);
  if (Object.keys(options).some((key) => !allowedFields.has(key))) throw new Error("Unknown history pagination field");
  const limit = limitValue(options.limit);
  const offsetId = integer("offsetId", options.offsetId ?? 0);
  const offsetDate = integer("offsetDate", options.offsetDate ?? 0);
  const addOffset = integer("addOffset", options.addOffset ?? 0, -MAX_INT - 1);
  const maxId = integer("maxId", options.maxId ?? 0);
  const minId = integer("minId", options.minId ?? 0);
  if (maxId > 0 && minId >= maxId) throw new Error("minId must be less than maxId");
  const input = await resolveInputPeer(context, chatId);
  const peer = await peerIdentity(context, input);
  const result = (await context.client.invoke(
    new Api.messages.GetHistory({ peer: input, offsetId, offsetDate, addOffset, limit, maxId, minId, hash: bigInt(0) }),
  )) as MessageContainer;
  const raw = rawMessages(result).slice(0, limit);
  if (raw.some((message) => !(message instanceof Api.MessageEmpty) && !belongsToPeer(message, peer))) {
    throw new Error("History response contains messages outside the requested chat");
  }
  const scoped = raw.filter((message) => belongsToPeer(message, peer));
  const page = summarize(scoped, result, "One bounded native history page; newest first; no read receipts.");
  return {
    ...page,
    pagination: {
      offsetId,
      offsetDate,
      addOffset,
      maxId,
      minId,
      limit,
      nextOffsetId: raw.length ? raw[raw.length - 1].id : null,
      endReached: raw.length === 0,
      cursorMeaning:
        "Last native ID. Request another page to establish the end; a nonempty page does not prove more exist.",
    },
  };
}

/** https://core.telegram.org/method/messages.searchSentMedia — no pagination is supported. */
export async function searchSentMedia(
  context: AdvancedMessagesContext,
  query = "",
  filter: SentMediaFilter = "document",
  requestedLimit = 20,
) {
  if (typeof query !== "string" || query.length > 1_024) throw new Error("query must contain at most 1024 characters");
  if (!SENT_MEDIA_FILTERS.includes(filter)) throw new Error(`Unsupported filter: ${filter}`);
  const limit = limitValue(requestedLimit);
  const filters: Record<SentMediaFilter, () => Api.TypeMessagesFilter> = {
    photo: () => new Api.InputMessagesFilterPhotos(),
    video: () => new Api.InputMessagesFilterVideo(),
    photoVideo: () => new Api.InputMessagesFilterPhotoVideo(),
    document: () => new Api.InputMessagesFilterDocument(),
    music: () => new Api.InputMessagesFilterMusic(),
    voice: () => new Api.InputMessagesFilterVoice(),
    gif: () => new Api.InputMessagesFilterGif(),
  };
  const result = await context.client.invoke(
    new Api.messages.SearchSentMedia({ q: sanitize(query), filter: filters[filter](), limit }),
  );
  return {
    ...summarize(rawMessages(result).slice(0, limit), result, "Recent sent media across chats; no read receipts."),
    paginationSupported: false,
    filter,
    limit,
  };
}
