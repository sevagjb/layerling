import { describe, expect, it } from "vitest";
import { MAX_DEPTH, parseMarkdown, parseMarkdownInline, safeMarkdownHref, type MarkdownBlock, type MarkdownInline } from "@/lib/markdownView";
import { ATTACHMENT_TYPES, attachmentView } from "@/lib/projectAttachments";

/*
 * The Markdown of the attachment viewer (#820, phase 2): what a file is read as, and above all what it
 * can never become - HTML, a script link, a picture fetched from a server, a parse that does not end.
 */

/** The text of a run of inline pieces, with the formatting left out. */
function plain(nodes: readonly MarkdownInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "code") return node.text;
      if (node.type === "image") return node.alt;
      return plain(node.children);
    })
    .join("");
}

/** The inline pieces of a file that is one paragraph. */
function paragraph(source: string) {
  const [block] = parseMarkdown(source);
  expect(block.type).toBe("paragraph");
  return (block as Extract<MarkdownBlock, { type: "paragraph" }>).children;
}

/** Every inline piece in a tree, however deep, so that a test can look for one kind anywhere. */
function allInline(blocks: readonly MarkdownBlock[]): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  const visit = (nodes: readonly MarkdownInline[]) => {
    for (const node of nodes) {
      out.push(node);
      if ("children" in node) visit(node.children);
    }
  };
  for (const block of blocks) {
    if (block.type === "heading" || block.type === "paragraph") visit(block.children);
    if (block.type === "quote") out.push(...allInline(block.children));
    if (block.type === "list") for (const item of block.items) out.push(...allInline(item.children));
    if (block.type === "table") for (const cell of [...block.head, ...block.rows.flat()]) visit(cell);
  }
  return out;
}

describe("which attachments the viewer shows", () => {
  it("shows Markdown formatted and text as it is, and only types that say so", () => {
    expect(attachmentView({ mediaType: "text/markdown" })).toBe("markdown");
    expect(attachmentView({ mediaType: "text/plain" })).toBe("text");
    expect(attachmentView({ mediaType: "application/pdf" })).toBeUndefined();
    for (const type of ATTACHMENT_TYPES) expect(["markdown", "text", undefined], type.extension).toContain(type.view);
  });
});

describe("what a file can never become", () => {
  it("keeps raw HTML as text", () => {
    const nodes = paragraph('Before <script>alert(1)</script> <img src="x" onerror="alert(2)"> after');
    expect(nodes).toEqual([{ type: "text", text: 'Before <script>alert(1)</script> <img src="x" onerror="alert(2)"> after' }]);
  });

  it("opens only web pages and e-mail addresses", () => {
    expect(safeMarkdownHref("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
    expect(safeMarkdownHref("HTTP://example.com")).toBe("HTTP://example.com");
    expect(safeMarkdownHref("mailto:maker@example.com")).toBe("mailto:maker@example.com");
    for (const refused of ["javascript:alert(1)", "JavaScript:alert(1)", "java\tscript:alert(1)", " javascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "file:///etc/passwd", "/settings", "../notes.md", "#top", "//evil.example", "https://", "mailto:"]) {
      expect(safeMarkdownHref(refused), refused).toBeNull();
    }
  });

  it("keeps a refused link's label as text and keeps its address out of the tree", () => {
    const [link] = paragraph("[click](javascript:alert(1))");
    expect(link).toEqual({ type: "link", href: null, children: [{ type: "text", text: "click" }] });
  });

  it("never names a picture as something to load, only its description and address", () => {
    const [image] = paragraph("![photo of the build](https://tracker.example/pixel.png)");
    expect(image).toEqual({ type: "image", alt: "photo of the build", src: "https://tracker.example/pixel.png" });
  });

  it("reads a link whose address has parentheses of its own", () => {
    const [link, rest] = paragraph("[nut](https://en.wikipedia.org/wiki/Nut_(hardware)) here");
    expect(link).toEqual(expect.objectContaining({ type: "link", href: "https://en.wikipedia.org/wiki/Nut_(hardware)" }));
    expect(rest).toEqual({ type: "text", text: " here" });
  });
});

describe("nesting and size", () => {
  it("stops nesting at MAX_DEPTH and shows the rest as text", () => {
    const quotes = parseMarkdown(`${"> ".repeat(MAX_DEPTH + 5)}deep`);
    let depth = 0;
    let blocks = quotes;
    while (blocks[0]?.type === "quote") {
      blocks = blocks[0].children;
      depth += 1;
    }
    expect(depth).toBe(MAX_DEPTH);
    expect(plain(allInline(blocks))).toContain("deep");

    const emphasis = parseMarkdownInline(`${"*".repeat(40)}x${"*".repeat(40)}`);
    expect(plain(emphasis)).toContain("x");
  });

  it("reads files made to be slow in about linear time", () => {
    const hostile = [
      "*a ".repeat(200_000),
      "[".repeat(500_000),
      "[a](".repeat(150_000),
      "`a".repeat(300_000),
      `# ${" ".repeat(500_000)}x`,
      `a|b\n|${" ".repeat(500_000)}x`,
      `- a\n${"\n".repeat(500_000)}`,
      `<a@${"b.".repeat(300_000)}`,
    ];
    for (const source of hostile) {
      const started = performance.now();
      parseMarkdown(source);
      // Quadratic time would take minutes here; linear takes well under a second.
      expect(performance.now() - started, source.slice(0, 8)).toBeLessThan(3000);
    }
  });
});

describe("blocks", () => {
  it("reads headings, rules and fenced code exactly as written", () => {
    const blocks = parseMarkdown("# Title ##\n\n### Parts\n\n---\n\n```\n<b>**not bold**</b>\n```");
    expect(blocks).toEqual([
      { type: "heading", level: 1, children: [{ type: "text", text: "Title" }] },
      { type: "heading", level: 3, children: [{ type: "text", text: "Parts" }] },
      { type: "rule" },
      { type: "code", text: "<b>**not bold**</b>" },
    ]);
  });

  it("joins the lines of a paragraph and keeps quotes apart", () => {
    const blocks = parseMarkdown("one\ntwo\n\n> quoted\n> still quoted");
    expect(blocks[0]).toEqual({ type: "paragraph", children: [{ type: "text", text: "one two" }] });
    expect(blocks[1]).toEqual({ type: "quote", children: [{ type: "paragraph", children: [{ type: "text", text: "quoted still quoted" }] }] });
  });

  it("reads tasks, numbers and lists inside lists", () => {
    const [tasks, numbers] = parseMarkdown("- [x] screws\n- [ ] feet\n  - two are enough\n- plain\n\n3. third\n4. fourth");
    expect(tasks.type === "list" && tasks.items.map((item) => item.checked)).toEqual([true, false, null]);
    const feet = tasks.type === "list" ? tasks.items[1].children : [];
    expect(feet.map((block) => block.type)).toEqual(["paragraph", "list"]);
    expect(numbers).toEqual(expect.objectContaining({ type: "list", ordered: true, start: 3 }));
  });

  it("reads a table with its alignment, and gives every row as many cells as the head", () => {
    const [table] = parseMarkdown("| Part | Time |\n|:-----|-----:|\n| Base | 2 h |\n| Lid |\n| a \\| b | c | extra |");
    if (table.type !== "table") throw new Error("not a table");
    expect(table.align).toEqual(["left", "right"]);
    expect(table.rows.map((row) => row.map(plain))).toEqual([["Base", "2 h"], ["Lid", ""], ["a | b", "c"]]);
  });

  it("does not take a line of dashes under a sentence with a pipe for a table of another width", () => {
    expect(parseMarkdown("a | b | c\n---").map((block) => block.type)).not.toContain("table");
  });
});

describe("inline", () => {
  it("reads emphasis, strike-through, code and links", () => {
    expect(paragraph("**bold** *it* ~~old~~ `a*b` [site](https://example.com) <maker@example.com>")).toEqual([
      { type: "strong", children: [{ type: "text", text: "bold" }] },
      { type: "text", text: " " },
      { type: "em", children: [{ type: "text", text: "it" }] },
      { type: "text", text: " " },
      { type: "del", children: [{ type: "text", text: "old" }] },
      { type: "text", text: " " },
      { type: "code", text: "a*b" },
      { type: "text", text: " " },
      { type: "link", href: "https://example.com", children: [{ type: "text", text: "site" }] },
      { type: "text", text: " " },
      { type: "link", href: "mailto:maker@example.com", children: [{ type: "text", text: "maker@example.com" }] },
    ]);
  });

  it("leaves underscores inside words, escapes and lone markers as text", () => {
    expect(plain(paragraph("file_name_v2.stl \\*not\\* 2 * 3 = 6"))).toBe("file_name_v2.stl *not* 2 * 3 = 6");
    expect(paragraph("file_name_v2.stl").every((node) => node.type === "text")).toBe(true);
  });
});
