import bigInt from "big-integer";
import { Api } from "telegram/tl/index.js";

/** Structural type keeps the pinned layer-233 runtime usable with GramJS's older declarations. */
export interface RichNode {
  className: string;
  getBytes(): Buffer;
  [key: string]: unknown;
}

export interface RichInspection {
  text: string;
  textLength: number;
  blockCount: number;
  tableCount: number;
  tables: Array<{ title: string; headers: string[]; rows: string[][] }>;
  unsupported: string[];
  truncated: boolean;
}

export const RICH_LIMITS = {
  sourceBytes: 128 * 1024,
  textLength: 32768,
  blockCount: 500,
  depth: 16,
  columns: 20,
} as const;

type Constructor = new (args: Record<string, unknown>) => RichNode;
const constructors = Api as unknown as Record<string, Constructor>;

function node(name: string, args: Record<string, unknown> = {}): RichNode {
  const Constructor = constructors[name];
  if (typeof Constructor !== "function") {
    throw new Error(
      `Telegram schema is missing ${name}; install the pinned layer-233 schema before compiling rich text.`,
    );
  }
  return new Constructor(args);
}

function checkDepth(depth: number): void {
  if (depth > RICH_LIMITS.depth) throw new Error(`Rich Markdown nesting exceeds ${RICH_LIMITS.depth} levels.`);
}

function plain(text: string): RichNode {
  return text ? node("TextPlain", { text }) : node("TextEmpty");
}

function concat(parts: RichNode[]): RichNode {
  if (!parts.length) return plain("");
  return parts.length === 1 ? parts[0] : node("TextConcat", { texts: parts });
}

function escaped(source: string, offset: number): boolean {
  let count = 0;
  for (let i = offset - 1; i >= 0 && source[i] === "\\"; i--) count++;
  return count % 2 === 1;
}

function closingDelimiter(source: string, delimiter: string, start: number): number {
  for (let i = start; i < source.length; i++) {
    if (!source.startsWith(delimiter, i) || escaped(source, i)) continue;
    if (delimiter === "*" || delimiter === "_") {
      let count = 1;
      while (source[i + count] === delimiter) count++;
      if (count % 2 === 0) {
        i += count - 1;
        continue;
      }
      return i + count - 1;
    }
    if ((delimiter === "**" || delimiter === "__") && source[i + 2] === delimiter[0]) return i + 1;
    return i;
  }
  return -1;
}

function linkAt(source: string, start: number): { label: string; url: string; end: number } | undefined {
  let closing = start + 1;
  let brackets = 1;
  for (; closing < source.length; closing++) {
    if (escaped(source, closing)) continue;
    if (source[closing] === "[") brackets++;
    if (source[closing] === "]" && --brackets === 0) break;
  }
  if (closing >= source.length || source[closing + 1] !== "(") return undefined;
  let end = closing + 2;
  let parentheses = 1;
  for (; end < source.length; end++) {
    if (escaped(source, end)) continue;
    if (source[end] === "(") parentheses++;
    if (source[end] === ")" && --parentheses === 0) break;
  }
  if (end >= source.length) throw new Error("Unclosed Markdown link destination.");
  const url = source.slice(closing + 2, end).trim();
  if (!/^(https?:\/\/|mailto:|tg:\/\/)/i.test(url) || /\s/.test(url) || [...url].some((c) => c.charCodeAt(0) < 32)) {
    throw new Error("Rich Markdown links require an http, https, mailto or tg URL without a title.");
  }
  return { label: source.slice(start + 1, closing), url, end: end + 1 };
}

function inline(source: string, depth = 1): RichNode {
  checkDepth(depth);
  const parts: RichNode[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) parts.push(plain(buffer));
    buffer = "";
  };
  for (let i = 0; i < source.length; ) {
    if (
      source.startsWith("$$", i) ||
      source.startsWith("\\(", i) ||
      source.startsWith("\\[", i) ||
      (source[i] === "$" && /^\$[^\s\d$][^$\n]*\$/.test(source.slice(i)))
    ) {
      throw new Error("Rich Markdown mathematical expressions are not supported by this compiler.");
    }
    if (source[i] === "\\" && i + 1 < source.length && /[\\`*_{}[\]()#+\-.!|>~]/.test(source[i + 1])) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }
    if (source.startsWith("![", i)) throw new Error("Rich Markdown media is not supported by this text-only compiler.");
    if (source.startsWith("[^", i)) throw new Error("Rich Markdown footnotes are not supported by this compiler.");
    if (source[i] === "<") {
      const match = /^<(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)>/.exec(source.slice(i));
      if (match) {
        flush();
        const label = match[1].replace(/^mailto:/, "");
        parts.push(node("TextUrl", { text: plain(label), url: match[1], webpageId: bigInt.zero }));
        i += match[0].length;
        continue;
      }
      if (/^<\/?[A-Za-z!][^>]*>/.test(source.slice(i))) {
        throw new Error("Inline HTML is not supported; use rich Markdown formatting instead.");
      }
    }
    if (source[i] === "[") {
      const link = linkAt(source, i);
      if (link) {
        flush();
        parts.push(node("TextUrl", { text: inline(link.label, depth + 1), url: link.url, webpageId: bigInt.zero }));
        i = link.end;
        continue;
      }
    }
    if (source[i] === "`") {
      let width = 1;
      while (source[i + width] === "`") width++;
      const marker = "`".repeat(width);
      const end = source.indexOf(marker, i + width);
      if (end === -1) throw new Error("Unclosed inline code span.");
      flush();
      parts.push(node("TextFixed", { text: plain(source.slice(i + width, end)) }));
      i = end + width;
      continue;
    }
    const delimiter = ["***", "___", "**", "__", "~~", "*", "_"].find((d) => source.startsWith(d, i));
    if (delimiter && !(delimiter.includes("_") && /[\p{L}\p{N}]/u.test(source[i - 1] ?? ""))) {
      const end = closingDelimiter(source, delimiter, i + delimiter.length);
      if (end !== -1) {
        flush();
        let text = inline(source.slice(i + delimiter.length, end), depth + 1);
        if (delimiter.length === 3) {
          checkDepth(depth + 2);
          text = node("TextBold", { text: node("TextItalic", { text }) });
        } else {
          const type = delimiter === "~~" ? "TextStrike" : delimiter.length === 2 ? "TextBold" : "TextItalic";
          text = node(type, { text });
        }
        parts.push(text);
        i = end + delimiter.length;
        continue;
      }
    }
    buffer += source[i++];
  }
  flush();
  return concat(parts);
}

/** Split GFM table cells while preserving escaped pipes and pipes inside code spans. */
function cells(line: string): string[] {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|") && !escaped(source, source.length - 1)) source = source.slice(0, -1);
  const result: string[] = [];
  let value = "";
  let codeWidth = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "`") {
      let width = 1;
      while (source[i + width] === "`") width++;
      if (codeWidth === 0) codeWidth = width;
      else if (codeWidth === width) codeWidth = 0;
      value += "`".repeat(width);
      i += width - 1;
    } else if (c === "|" && codeWidth && escaped(source, i)) {
      value = `${value.slice(0, -1)}|`;
    } else if (c === "|" && !codeWidth && !escaped(source, i)) {
      result.push(value.trim());
      value = "";
    } else value += c;
  }
  result.push(value.trim());
  return result;
}

function separator(line: string): boolean {
  return line.includes("|") && cells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function heading(line: string): RegExpExecArray | null {
  return /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
}

function listItem(line: string): RegExpExecArray | null {
  return /^ {0,3}(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
}

function isRule(line: string): boolean {
  return /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
}

function boundary(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    !line?.trim() ||
    Boolean(heading(line)) ||
    Boolean(listItem(line)) ||
    /^ {0,3}(?:```|~~~|>)/.test(line) ||
    isRule(line) ||
    (index + 1 < lines.length && line.includes("|") && separator(lines[index + 1]))
  );
}

export function compileRichMarkdown(
  markdown: string,
  options: { rtl?: boolean; noautolink?: boolean } = {},
): { input: RichNode; blocks: RichNode[]; inspection: RichInspection } {
  if (typeof markdown !== "string" || !markdown.trim()) throw new Error("Rich Markdown must contain text.");
  if (Buffer.byteLength(markdown, "utf8") > RICH_LIMITS.sourceBytes) {
    throw new Error(`Rich Markdown source exceeds ${RICH_LIMITS.sourceBytes} UTF-8 bytes.`);
  }
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(markdown)) {
    throw new Error("Rich Markdown contains an unpaired UTF-16 surrogate.");
  }
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s+(?:[-+*]|\d+[.)])\s/.test(line)) {
      throw new Error("Nested or indented Markdown lists are not supported.");
    }
    if (/^ {4}\S/.test(line)) throw new Error("Indented code or nested lists are not supported; use fenced code.");
    if (/^\s*\[\^[^\]]+\]:/.test(line)) throw new Error("Rich Markdown footnotes are not supported by this compiler.");
    const fence = /^ {0,3}(`{3,}|~{3,})([^`~]*)$/.exec(line);
    if (fence) {
      const content: string[] = [];
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      i++;
      while (i < lines.length && !closing.test(lines[i])) content.push(lines[i++]);
      if (i === lines.length) throw new Error("Unclosed fenced code block.");
      const language = fence[2].trim();
      if (language === "math")
        throw new Error("Rich Markdown mathematical expressions are not supported by this compiler.");
      if (language.length > 64 || /\s/.test(language))
        throw new Error("Code fence language must be one short identifier.");
      blocks.push(node("PageBlockPreformatted", { text: plain(content.join("\n")), language }));
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && separator(lines[i + 1])) {
      const headers = cells(line);
      const alignments = cells(lines[i + 1]);
      if (headers.length !== alignments.length)
        throw new Error("Table header and separator have different column counts.");
      if (headers.length > RICH_LIMITS.columns)
        throw new Error(`Rich tables support at most ${RICH_LIMITS.columns} columns.`);
      const makeRow = (values: string[], header = false) => {
        if (values.length > headers.length) throw new Error("Table row has more cells than its header.");
        const row = Array.from({ length: headers.length }, (_, column) =>
          node("PageTableCell", {
            text: inline(values[column] ?? "", 3),
            ...(header ? { header: true } : {}),
            ...(alignments[column].startsWith(":") && alignments[column].endsWith(":")
              ? { alignCenter: true }
              : alignments[column].endsWith(":")
                ? { alignRight: true }
                : {}),
          }),
        );
        return node("PageTableRow", { cells: row });
      };
      const rows = [makeRow(headers, true)];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(makeRow(cells(lines[i++])));
      blocks.push(node("PageBlockTable", { title: plain(""), rows, bordered: true, striped: true, compact: true }));
      continue;
    }
    const title = heading(line);
    if (title) {
      blocks.push(node(`PageBlockHeading${title[1].length}`, { text: inline(title[2]) }));
      i++;
      continue;
    }
    if (isRule(line)) {
      blocks.push(node("PageBlockDivider"));
      i++;
      continue;
    }
    const item = listItem(line);
    if (item) {
      const ordered = item[2] !== undefined;
      const items: RichNode[] = [];
      let next = item;
      while (next && (next[2] !== undefined) === ordered) {
        const task = /^\[([ xX])\]\s+(.+)$/.exec(next[3]);
        items.push(
          node(ordered ? "PageListOrderedItemText" : "PageListItemText", {
            text: inline(task ? task[2] : next[3], 2),
            ...(ordered ? { num: next[2] } : {}),
            ...(task ? { checkbox: true, ...(task[1].toLowerCase() === "x" ? { checked: true } : {}) } : {}),
          }),
        );
        i++;
        if (/^\s+(?:[-+*]|\d+[.)])\s/.test(lines[i] ?? "")) {
          throw new Error("Nested or indented Markdown lists are not supported.");
        }
        next = listItem(lines[i] ?? "") as RegExpExecArray;
      }
      blocks.push(node(ordered ? "PageBlockOrderedList" : "PageBlockList", { items }));
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^ {0,3}> ?/, ""));
      if (quote.some((text) => /^>|^#|^[-*+]\s/.test(text))) {
        throw new Error("Nested block formatting inside quotes is not supported.");
      }
      blocks.push(node("PageBlockBlockquote", { text: inline(quote.join("\n")), caption: plain("") }));
      continue;
    }
    const paragraph = [line];
    i++;
    while (i < lines.length && !boundary(lines, i)) {
      if (/^ {4}\S/.test(lines[i])) throw new Error("Indented code or nested lists are not supported.");
      paragraph.push(lines[i++]);
    }
    blocks.push(node("PageBlockParagraph", { text: inline(paragraph.join("\n")) }));
  }
  const input = node("InputRichMessage", { blocks, ...options });
  const inspection = inspectRichMessage(input);
  if (inspection.truncated || inspection.unsupported.length) {
    throw new Error(
      `Rich Markdown exceeds Telegram limits: ${inspection.unsupported.join(", ") || "truncated content"}.`,
    );
  }
  return { input, blocks, inspection };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Bounded projection for native blocks; unsupported content is labelled rather than silently dropped. */
export function inspectRichMessage(rich: unknown): RichInspection {
  const result: RichInspection = {
    text: "",
    textLength: 0,
    blockCount: 0,
    tableCount: 0,
    tables: [],
    unsupported: [],
    truncated: false,
  };
  const unsupported = new Set<string>();
  let remaining = RICH_LIMITS.textLength;
  let textNodes = 0;
  const note = (name: string, truncate = false) => {
    if (unsupported.size < 50) unsupported.add(name);
    if (truncate) result.truncated = true;
  };
  const text = (value: unknown, depth = 1): string => {
    if (++textNodes > RICH_LIMITS.textLength) {
      note("rich text node limit", true);
      return "";
    }
    if (depth > RICH_LIMITS.depth) {
      note("nesting limit", true);
      return "";
    }
    const v = record(value);
    if (!v) {
      note("invalid rich text");
      return "";
    }
    const name = String(v.className ?? "UnknownRichText").slice(0, 128);
    if (name === "TextEmpty") return "";
    if (name === "TextPlain" || name === "TextCustomEmoji") {
      const content = String(name === "TextCustomEmoji" ? (v.alt ?? "") : (v.text ?? ""));
      const characters = Array.from(content);
      const accepted = characters.slice(0, remaining).join("");
      if (characters.length > remaining) note("text length limit", true);
      remaining -= Math.min(remaining, characters.length);
      return accepted;
    }
    if (name === "TextConcat") {
      if (!Array.isArray(v.texts)) {
        note("invalid TextConcat");
        return "";
      }
      if (v.texts.length > RICH_LIMITS.textLength) note("rich text node limit", true);
      const parts: string[] = [];
      for (const part of v.texts.slice(0, RICH_LIMITS.textLength)) {
        parts.push(text(part, depth + 1));
        if (textNodes >= RICH_LIMITS.textLength) {
          note("rich text node limit", true);
          break;
        }
      }
      return parts.join("");
    }
    if (
      /^Text(?:Bold|Italic|Underline|Strike|Fixed|Url|Email|Phone|Subscript|Superscript|Marked|Anchor|Spoiler|Mention|Hashtag|BotCommand|Cashtag|AutoUrl|AutoEmail|AutoPhone|BankCard|MentionName|Date|TonAddress)$/.test(
        name,
      )
    ) {
      return text(v.text, depth + 1);
    }
    note(name);
    return "";
  };
  const count = (): boolean => {
    result.blockCount++;
    if (result.blockCount > RICH_LIMITS.blockCount) {
      note("block count limit", true);
      return false;
    }
    return true;
  };
  const visit = (value: unknown, depth = 1): string => {
    if (depth > RICH_LIMITS.depth) {
      note("nesting limit", true);
      return "";
    }
    if (!count()) return "";
    const v = record(value);
    if (!v) {
      note("invalid block");
      return "";
    }
    const name = String(v.className ?? "UnknownPageBlock").slice(0, 128);
    if (
      /^PageBlock(?:Heading[1-6]|Title|Subtitle|Header|Subheader|Paragraph|Preformatted|Footer|Kicker|Thinking)$/.test(
        name,
      )
    ) {
      return text(v.text, depth + 1);
    }
    if (name === "PageBlockDivider") return "—";
    if (name === "PageBlockBlockquote" || name === "PageBlockPullquote") {
      return [text(v.text, depth + 1), text(v.caption, depth + 1)].filter(Boolean).join("\n");
    }
    if (name === "PageBlockTable") {
      result.tableCount++;
      const title = text(v.title, depth + 1);
      const rows: string[][] = [];
      let headers: string[] = [];
      const nativeRows = Array.isArray(v.rows) ? v.rows : [];
      for (let i = 0; i < nativeRows.length; i++) {
        if (!count()) break;
        const row = record(nativeRows[i]);
        if (!row || !Array.isArray(row.cells)) {
          note("invalid table row");
          continue;
        }
        if (row.cells.length > RICH_LIMITS.columns) note("table column limit", true);
        const nativeCells = row.cells.slice(0, RICH_LIMITS.columns).map(record);
        const values = nativeCells.map((cell) => {
          if (!cell) {
            note("invalid table cell");
            return "";
          }
          if (Number(cell.colspan ?? 1) > 1 || Number(cell.rowspan ?? 1) > 1) note("merged table cells");
          return cell.text ? text(cell.text, depth + 2) : "";
        });
        if (i === 0 && nativeCells.every((cell) => cell?.header)) headers = values;
        else rows.push(values);
      }
      result.tables.push({ title, headers, rows });
      return [title, ...(headers.length ? [headers.join(" | ")] : []), ...rows.map((row) => row.join(" | "))]
        .filter(Boolean)
        .join("\n");
    }
    if (name === "PageBlockList" || name === "PageBlockOrderedList") {
      const items = Array.isArray(v.items) ? v.items : [];
      const lines: string[] = [];
      for (let i = 0; i < items.length; i++) {
        if (!count()) break;
        const item = record(items[i]);
        if (!item) {
          note("invalid list item");
          continue;
        }
        const prefix = item.checkbox
          ? item.checked
            ? "[x] "
            : "[ ] "
          : name === "PageBlockOrderedList"
            ? `${String(item.num ?? i + 1).slice(0, 32)}. `
            : "• ";
        if (item.text) lines.push(prefix + text(item.text, depth + 1));
        else if (Array.isArray(item.blocks))
          lines.push(
            prefix +
              item.blocks
                .slice(0, RICH_LIMITS.blockCount)
                .map((b) => visit(b, depth + 1))
                .join("\n"),
          );
        else note("invalid list item");
      }
      return lines.join("\n");
    }
    if (name === "PageBlockDetails" || name === "PageBlockBlockquoteBlocks") {
      const nested = Array.isArray(v.blocks) ? v.blocks : [];
      if (nested.length > RICH_LIMITS.blockCount) note("block count limit", true);
      const caption = v.title ?? v.caption;
      return [
        caption ? text(caption, depth + 1) : "",
        ...nested.slice(0, RICH_LIMITS.blockCount).map((b) => visit(b, depth + 1)),
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    note(name);
    return `[${name}]`;
  };
  const source = record(rich);
  if (source?.part === true) note("partial rich message", true);
  if (!source || !Array.isArray(source.blocks)) note("missing rich message blocks");
  else {
    if (source.blocks.length > RICH_LIMITS.blockCount) note("block count limit", true);
    result.text = source.blocks
      .slice(0, RICH_LIMITS.blockCount)
      .map((block) => visit(block))
      .filter(Boolean)
      .join("\n\n");
  }
  result.textLength = RICH_LIMITS.textLength - remaining;
  result.unsupported = [...unsupported];
  return result;
}
