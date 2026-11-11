import { Api } from "telegram/tl/index.js";
import { z } from "zod";

const int = z.number().int().min(0).max(2147483647);
const id = int.min(1);
export const formattingEntitySchema = z
  .object({
    type: z.enum(["bold", "italic", "underline", "strike", "spoiler", "code", "pre", "text_url"]),
    offset: int,
    length: id,
    url: z.string().max(4096).optional(),
    language: z.string().max(64).optional(),
  })
  .strict();

export type FormattingEntity = z.infer<typeof formattingEntitySchema>;
export interface TextFormattingOptions {
  parseMode?: "md" | "html";
  entities?: FormattingEntity[];
  noWebpage?: boolean;
  invertMedia?: boolean;
}

export interface MessageWriteOptions extends TextFormattingOptions {
  quoteText?: string;
  quoteOffset?: number;
  effect?: string;
  silent?: boolean;
  background?: boolean;
  clearDraft?: boolean;
  protectContent?: boolean;
  scheduleDate?: number;
  scheduleRepeatPeriod?: number;
  sendAs?: string;
  replyToPeer?: string;
}

export const textFormattingFields = {
  entities: z
    .array(formattingEntitySchema)
    .max(100)
    .optional()
    .describe(
      "Explicit formatting entities; offsets/lengths are UTF-16 code units in the unparsed text. Mutually exclusive with parseMode.",
    ),
  noWebpage: z.boolean().optional().describe("Disable web page previews"),
  invertMedia: z.boolean().optional().describe("Place the link preview above the text"),
};

export const messageWriteFields = {
  ...textFormattingFields,
  quoteOffset: int.optional().describe("UTF-16 quote offset in the replied-to message; requires quoteText and replyTo"),
  silent: z.boolean().optional(),
  background: z.boolean().optional(),
  clearDraft: z.boolean().optional(),
  protectContent: z.boolean().optional().describe("Disable forwarding/saving (MTProto noforwards)"),
  scheduleDate: id.optional().describe("Future Unix timestamp; the server controls supported scheduling limits"),
  scheduleRepeatPeriod: id
    .optional()
    .describe("Telegram repeat period in seconds; requires scheduleDate and server eligibility"),
  sendAs: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe("Peer to send as; requires the corresponding server permission"),
  replyToPeer: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe("Peer of a cross-chat replied-to message; requires replyTo"),
};

function boundary(text: string, offset: number): boolean {
  return !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  );
}

export function formattingEntities(
  text: string,
  entities?: FormattingEntity[],
  parseMode?: string,
): Api.TypeMessageEntity[] | undefined {
  if (entities !== undefined && parseMode) throw new Error("entities and parseMode are mutually exclusive.");
  if (!entities) return undefined;
  if (entities.length > 100) throw new Error("At most 100 formatting entities are allowed.");
  const names = {
    bold: "MessageEntityBold",
    italic: "MessageEntityItalic",
    underline: "MessageEntityUnderline",
    strike: "MessageEntityStrike",
    spoiler: "MessageEntitySpoiler",
    code: "MessageEntityCode",
    pre: "MessageEntityPre",
    text_url: "MessageEntityTextUrl",
  } as const;
  return entities.map((raw) => {
    const entity = formattingEntitySchema.parse(raw);
    if (
      entity.offset + entity.length > text.length ||
      !boundary(text, entity.offset) ||
      !boundary(text, entity.offset + entity.length)
    ) {
      throw new Error("Formatting entity range is outside the text or splits a UTF-16 surrogate pair.");
    }
    if (entity.type === "text_url" && (!entity.url || !/^(https?:\/\/|mailto:|tg:\/\/)/i.test(entity.url))) {
      throw new Error("text_url requires an http, https, mailto or tg URL.");
    }
    if (entity.type !== "text_url" && entity.url !== undefined) throw new Error("Only text_url accepts url.");
    if (entity.type !== "pre" && entity.language !== undefined) throw new Error("Only pre accepts language.");
    const Constructor = (Api as unknown as Record<string, new (args: object) => Api.TypeMessageEntity>)[
      names[entity.type]
    ];
    return new Constructor({
      offset: entity.offset,
      length: entity.length,
      ...(entity.type === "text_url" ? { url: entity.url } : {}),
      ...(entity.type === "pre" ? { language: entity.language ?? "" } : {}),
    });
  });
}

export function validateWriteOptions(options: MessageWriteOptions, replyTo?: number): void {
  if (
    options.scheduleDate !== undefined &&
    (!Number.isInteger(options.scheduleDate) || options.scheduleDate <= Math.floor(Date.now() / 1000))
  ) {
    throw new Error("scheduleDate must be a future Unix timestamp.");
  }
  if (options.scheduleRepeatPeriod !== undefined && options.scheduleDate === undefined)
    throw new Error("scheduleRepeatPeriod requires scheduleDate.");
  if (options.replyToPeer !== undefined && replyTo === undefined) throw new Error("replyToPeer requires replyTo.");
  if (options.quoteOffset !== undefined && (!options.quoteText || replyTo === undefined))
    throw new Error("quoteOffset requires quoteText and replyTo.");
}
