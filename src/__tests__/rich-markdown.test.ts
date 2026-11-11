import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BinaryReader } from "telegram/extensions/BinaryReader.js";
import { Api } from "telegram/tl/index.js";
import { compileRichMarkdown, inspectRichMessage, RICH_LIMITS, type RichNode } from "../rich-markdown.js";

function children(value: unknown, seen = new WeakSet<object>()): RichNode[] {
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const node = value as RichNode;
  return [
    node,
    ...Object.values(node).flatMap((part) =>
      Array.isArray(part) ? part.flatMap((item) => children(item, seen)) : children(part, seen),
    ),
  ];
}

function table(columns = 2, bodyRows = 1): string {
  return [
    `| ${Array.from({ length: columns }, (_, i) => `H${i}`).join(" | ")} |`,
    `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`,
    ...Array.from(
      { length: bodyRows },
      (_, row) => `| ${Array.from({ length: columns }, (_, col) => `${row}:${col}`).join(" | ")} |`,
    ),
  ].join("\n");
}

describe("compileRichMarkdown", () => {
  it("uses real layer-233 native headings, structured input and round-trippable table blocks", () => {
    const compiled = compileRichMarkdown("# Report\n\n| Name | Value |\n|:---|---:|\n| A | **42** |", {
      rtl: true,
      noautolink: true,
    });
    assert.equal(compiled.input.className, "InputRichMessage");
    assert.equal(compiled.blocks[0].className, "PageBlockHeading1");
    assert.equal(compiled.blocks[1].className, "PageBlockTable");
    assert.equal(compiled.input.rtl, true);
    assert.equal(compiled.input.noautolink, true);
    assert.equal(compiled.input.getBytes().readUInt32LE(0), 0xe4c449fc);
    const decoded = new BinaryReader(compiled.input.getBytes()).tgReadObject();
    assert.deepEqual(inspectRichMessage(decoded), compiled.inspection);
    assert.deepEqual(compiled.inspection.tables, [{ title: "", headers: ["Name", "Value"], rows: [["A", "42"]] }]);
  });

  it("preserves table header flags, center/right alignment and blank cells", () => {
    const compiled = compileRichMarkdown("| L | C | R |\n|:---|:---:|---:|\n| one | two |\n| | | | ");
    const rows = compiled.blocks[0].rows as RichNode[];
    const headers = rows[0].cells as RichNode[];
    assert.ok(headers.every((cell) => cell.header === true));
    assert.equal(headers[0].alignRight, undefined);
    assert.equal(headers[1].alignCenter, true);
    assert.equal(headers[2].alignRight, true);
    assert.equal((compiled.blocks[0].title as RichNode).className, "TextEmpty");
    assert.deepEqual(compiled.inspection.tables[0].rows, [
      ["one", "two", ""],
      ["", "", ""],
    ]);
  });

  it("does not split escaped pipes or pipes inside inline code", () => {
    const result = compileRichMarkdown("| A | B |\n|---|---|\n| a\\|b | `x|y` |\n| `x\\|y` | z |");
    assert.deepEqual(result.inspection.tables[0].rows, [
      ["a|b", "x|y"],
      ["x|y", "z"],
    ]);
  });

  it("preserves URLs, Unicode and nested inline emphasis as native rich text", () => {
    const result = compileRichMarkdown(
      "[**Цена 😀**](https://example.com/a_(b)?x=1) and **bold *italic***, ~~old~~, `code`.",
    );
    const nodes = children(result.input);
    const link = nodes.find((part) => part.className === "TextUrl");
    assert.equal(link?.url, "https://example.com/a_(b)?x=1");
    assert.equal(String(link?.webpageId), "0");
    assert.ok(nodes.some((part) => part.className === "TextBold"));
    assert.ok(nodes.some((part) => part.className === "TextItalic"));
    assert.ok(nodes.some((part) => part.className === "TextStrike"));
    assert.ok(nodes.some((part) => part.className === "TextFixed"));
    assert.equal(result.inspection.text, "Цена 😀 and bold italic, old, code.");
  });

  it("keeps ordinary dollar prices, escaped punctuation and Unicode footnote markers literal", () => {
    const result = compileRichMarkdown("Курс: **$1 = 91,4 ₽**. Цена²: €449. \\*literal\\* \\_name\\_.");
    assert.equal(result.inspection.text, "Курс: $1 = 91,4 ₽. Цена²: €449. *literal* _name_.");
  });

  it("compiles code, quote, rules, unordered and ordered checkbox lists", () => {
    const result = compileRichMarkdown(
      "```ts\nconst x = '**literal**';\n```\n\n> A **quote**\n> continued\n\n---\n\n- one\n- [x] checked\n\n3. three\n4. [ ] four",
    );
    assert.deepEqual(
      result.blocks.map((block) => block.className),
      ["PageBlockPreformatted", "PageBlockBlockquote", "PageBlockDivider", "PageBlockList", "PageBlockOrderedList"],
    );
    assert.match(result.inspection.text, /const x = '\*\*literal\*\*';/);
    assert.match(result.inspection.text, /A quote\ncontinued/);
    assert.match(result.inspection.text, /\[x\] checked/);
    assert.match(result.inspection.text, /3\. three/);
    assert.match(result.inspection.text, /\[ \] four/);
    assert.equal(result.inspection.blockCount, 9);
    assert.doesNotThrow(() => result.input.getBytes());
  });

  it("compiles a full 26-property report with two tables and all prices/links", () => {
    const first = ["| Stay | Author | Total | Old price | Reviews¹ | Notes |", "|---|---|---:|---:|---|---|"];
    for (let i = 1; i <= 22; i++) {
      first.push(`| [Riad ${i}](https://example.com/${i}) | Person | **${i} 000 ₽** | — | 9,5 / 43 | Warm room |`);
    }
    const second = ["| Stay | Total | Reviews¹ | Notes |", "|---|---:|---|---|"];
    for (let i = 23; i <= 26; i++)
      second.push(`| [Riad ${i}](https://example.com/${i}) | ≈16 828 ₽² | 5/5 / 13 | Two bedrooms |`);
    const result = compileRichMarkdown(
      `# Morocco\n\nКурс **$1 = 91,4 ₽**.\n\n## Marrakech\n\n${first.join("\n")}\n\n## Fes\n\n${second.join("\n")}\n\n² Historical prices.`,
    );
    assert.equal(result.inspection.tableCount, 2);
    assert.deepEqual(
      result.inspection.tables.map((t) => t.rows.length),
      [22, 4],
    );
    assert.equal(result.inspection.tables[0].headers.length, 6);
    assert.equal(children(result.input).filter((part) => part.className === "TextUrl").length, 26);
    assert.equal(result.inspection.truncated, false);
    assert.deepEqual(result.inspection.unsupported, []);
    assert.doesNotThrow(() => result.input.getBytes());
  });

  it("counts visible Unicode characters rather than UTF-16 units", () => {
    const result = compileRichMarkdown("😀".repeat(RICH_LIMITS.textLength));
    assert.equal(result.inspection.textLength, RICH_LIMITS.textLength);
    assert.equal(result.inspection.truncated, false);
    assert.throws(() => compileRichMarkdown("a".repeat(RICH_LIMITS.textLength + 1)), /text length limit/);
  });

  it("enforces raw source and surrogate constraints before serialization", () => {
    assert.throws(() => compileRichMarkdown("a".repeat(RICH_LIMITS.sourceBytes + 1)), /UTF-8 bytes/);
    assert.throws(() => compileRichMarkdown("bad\ud800"), /surrogate/);
    assert.throws(() => compileRichMarkdown("   \n"), /must contain text/);
  });

  it("includes table rows and list items in the 500-block ceiling", () => {
    assert.equal(compileRichMarkdown(table(1, 498)).inspection.blockCount, 500);
    assert.throws(() => compileRichMarkdown(table(1, 499)), /block count limit/);
    assert.equal(compileRichMarkdown(Array.from({ length: 500 }, () => "a").join("\n\n")).inspection.blockCount, 500);
    assert.throws(() => compileRichMarkdown(Array.from({ length: 501 }, () => "a").join("\n\n")), /block count limit/);
    assert.throws(() => compileRichMarkdown(Array.from({ length: 500 }, () => "- a").join("\n")), /block count limit/);
  });

  it("enforces table dimensions without dropping excessive cells", () => {
    assert.equal(compileRichMarkdown(table(20)).inspection.tables[0].headers.length, 20);
    assert.throws(() => compileRichMarkdown(table(21)), /at most 20 columns/);
    assert.throws(() => compileRichMarkdown("| A | B |\n|---|---|\n|1|2|3|"), /more cells/);
    assert.throws(() => compileRichMarkdown("| A | B |\n|---|---|---|\n|1|2|"), /different column counts/);
  });

  it("rejects excessive nesting before constructing an unsafe payload", () => {
    let value = "x";
    for (let i = 0; i < 20; i++) value = `[${value}](https://example.com/${i})`;
    assert.throws(() => compileRichMarkdown(value), /nesting/);
  });

  it("fails explicitly for unsupported rich features rather than downgrading them", () => {
    for (const source of [
      "![image](https://example.com/a.png)",
      "<b>html</b>",
      "[^a]: footnote",
      "$x^2$",
      "$$x$$",
      "\\(x\\)",
      "```math\nx\n```",
      "- outer\n  - nested",
    ]) {
      assert.throws(() => compileRichMarkdown(source), /not supported|not supported by this|Nested/);
    }
    assert.throws(() => compileRichMarkdown("[click](javascript:alert(1))"), /http, https/);
    assert.throws(() => compileRichMarkdown("[click](https://example.com"), /Unclosed/);
    assert.throws(() => compileRichMarkdown("```ts\nunclosed"), /Unclosed/);
    assert.throws(() => compileRichMarkdown("`unclosed"), /Unclosed/);
  });
});

describe("inspectRichMessage", () => {
  it("labels incomplete and unsupported incoming blocks", () => {
    const result = inspectRichMessage({ part: true, blocks: [{ className: "PageBlockPhoto" }] });
    assert.equal(result.truncated, true);
    assert.deepEqual(result.unsupported, ["partial rich message", "PageBlockPhoto"]);
    assert.equal(result.text, "[PageBlockPhoto]");
  });

  it("bounds cyclic rich text instead of overflowing", () => {
    const text: Record<string, unknown> = { className: "TextBold" };
    text.text = text;
    const result = inspectRichMessage({ blocks: [{ className: "PageBlockParagraph", text }] });
    assert.equal(result.truncated, true);
    assert.ok(result.unsupported.includes("nesting limit"));
  });

  it("bounds hostile nested concatenations and table columns", () => {
    let text: unknown = { className: "TextEmpty" };
    for (let i = 0; i < 5; i++) text = { className: "TextConcat", texts: Array(100).fill(text) };
    const result = inspectRichMessage({ blocks: [{ className: "PageBlockParagraph", text }] });
    assert.equal(result.truncated, true);
    assert.ok(result.unsupported.includes("rich text node limit"));
    const table = inspectRichMessage({
      blocks: [
        {
          className: "PageBlockTable",
          title: new Api.TextEmpty(),
          rows: [{ cells: Array(21).fill({ text: new Api.TextPlain({ text: "x" }) }) }],
        },
      ],
    });
    assert.equal(table.truncated, true);
    assert.ok(table.unsupported.includes("table column limit"));
    assert.equal(table.tables[0].rows[0].length, 20);
  });

  it("does not claim unsupported merged cells or missing blocks are lossless", () => {
    const result = inspectRichMessage({
      blocks: [
        {
          className: "PageBlockTable",
          title: new Api.TextEmpty(),
          rows: [{ cells: [{ colspan: 2, text: new Api.TextPlain({ text: "x" }) }] }],
        },
      ],
    });
    assert.ok(result.unsupported.includes("merged table cells"));
    assert.deepEqual(inspectRichMessage({}).unsupported, ["missing rich message blocks"]);
  });
});
