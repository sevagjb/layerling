/*
 * Markdown read for showing, not for running (#820, phase 2): the attachment viewer shows a `.md` file
 * a design carries - assembly instructions, a parts list - as formatted text.
 *
 * Why a parser of its own, and why it returns a tree and not HTML:
 *
 *   - An attachment comes from anywhere: a download, a shared design, an AI agent. It is shown on
 *     layerling's own page, next to every design kept in this browser, so nothing in it may ever run.
 *     This module therefore never makes HTML. It turns the text into plain objects (`MarkdownBlock`,
 *     `MarkdownInline`) and `MarkdownView.tsx` draws them as React elements, which escape every piece of
 *     text by themselves. There is no `innerHTML` anywhere on the way, so there is nothing to escape wrong.
 *   - Raw HTML in a file stays text: `<script>` is shown as the eight characters it is.
 *   - A picture is not loaded. Loading `![](https://…)` would tell another server that the file was
 *     opened, and when; the viewer shows the picture's description and address instead.
 *   - A link is a link only when it goes to a web page (`http:`, `https:`) or an e-mail address
 *     (`mailto:`). Anything else - `javascript:`, `data:`, a relative path - is shown as plain text.
 *   - Nesting (a quote in a quote in a list ...) stops at `MAX_DEPTH`, so a file cannot make the parser
 *     or the page recurse without end.
 *
 * What it reads is the Markdown people write by hand in notes and readmes, the same set the user
 * guide is written in (`scripts/build-guide.mjs`), plus what GitHub adds to it that a parts list
 * uses: task lists and strike-through.
 *
 *   blocks:  # headings (1 to 6), paragraphs, - * + and 1. lists (nested by indenting), - [ ] tasks,
 *            > quotes, ``` fenced code, --- rules, | tables |
 *   inline:  `code`, **bold** __bold__, *italic* _italic_, ~~struck~~, [links](url), <https://…>,
 *            ![pictures](url) (not loaded), \ escapes
 *
 * Anything else is shown as the text it is, so nothing a file says goes missing.
 *
 * Nothing here touches the browser or React; `tests/unit/markdownView.test.ts` runs it as it is.
 */

// ---------------------------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------------------------

/** A run of text inside a block. */
export type MarkdownInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong" | "em" | "del"; children: MarkdownInline[] }
  /** `href` is null when the target is not one that may be opened; the label is then shown as text. */
  | { type: "link"; href: string | null; children: MarkdownInline[] }
  /** Never loaded: the viewer shows `alt` and the address. */
  | { type: "image"; alt: string; src: string };

/** One block of a list: the blocks it holds, and for a task its tick (null when it is no task). */
export type MarkdownListItem = { checked: boolean | null; children: MarkdownBlock[] };

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInline[] }
  | { type: "paragraph"; children: MarkdownInline[] }
  | { type: "list"; ordered: boolean; start: number; items: MarkdownListItem[] }
  | { type: "quote"; children: MarkdownBlock[] }
  | { type: "code"; text: string }
  | { type: "rule" }
  | { type: "table"; align: Array<"left" | "center" | "right" | null>; head: MarkdownInline[][]; rows: MarkdownInline[][][] };

/** How deep quotes, lists and emphasis may nest before the rest is taken as plain text. */
export const MAX_DEPTH = 12;

// ---------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------

/**
 * The address a link may open, or null. Only web pages and e-mail addresses: everything else a link
 * can name - a script (`javascript:`), inline content (`data:`), a file on the computer (`file:`), a
 * path relative to layerling's own page - is refused. The test is on the address with spaces and
 * control characters taken out, because browsers ignore those too ("java\tscript:" is `javascript:`).
 */
export function safeMarkdownHref(target: string): string | null {
  const href = target.trim();
  const compact = href.replace(/[\u0000-\u0020\u007f]/g, "");
  if (/^https?:\/\/[^/]/i.test(compact) || /^mailto:[^\s]/i.test(compact)) return compact;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------------------------

/** Characters a backslash turns back into text, as in CommonMark. */
const ESCAPABLE = "\\`*_{}[]()#+-.!|~<>\"'";

/** Adds text to the list, joined to the text before it so the tree stays small. */
function pushText(out: MarkdownInline[], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

/**
 * What one walk over a text has found out so far, so that nothing is looked for twice.
 *
 * Without it a file of thousands of `*`, `[` or backticks that nothing closes would make each of them
 * search to the end of the text, which grows with the square of its length: a 2 MB attachment would
 * then freeze the page for minutes. With it a text is read in time that grows with its length (times
 * the nesting, which `MAX_DEPTH` caps), whatever is in it.
 */
type InlineScan = {
  text: string;
  /** Each `[` that has its `]`, by position, matched once with a stack. */
  brackets: Map<number, number>;
  /** The positions of every `)` in order, made when a link first needs one. */
  parens: number[] | null;
  /** For a marker or a run of backticks: the position from which it was looked for and is not there. */
  missing: Map<string, number>;
};

function inlineScan(text: string): InlineScan {
  const brackets = new Map<number, number>();
  const open: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === "[") open.push(index);
    else if (char === "]" && open.length > 0) brackets.set(open.pop()!, index);
  }
  return { text, brackets, parens: null, missing: new Map() };
}

/**
 * Where `needle` next appears at or after `from`, or -1. A miss is remembered: what is not there from
 * one place on is not there from any later place either, so it is never searched for again.
 */
function findFrom(scan: InlineScan, needle: string, from: number) {
  const missingFrom = scan.missing.get(needle);
  if (missingFrom !== undefined && from >= missingFrom) return -1;
  const found = scan.text.indexOf(needle, from);
  if (found < 0) scan.missing.set(needle, from);
  return found;
}

/** A run of backticks, read where it starts (sticky, so nothing is copied). */
const BACKTICKS = /`+/y;

function backtickRun(text: string, index: number) {
  BACKTICKS.lastIndex = index;
  return BACKTICKS.exec(text)?.[0] ?? "";
}

/**
 * A link's target written right after its label: `(url)` or `(url "title")`, the title being dropped.
 * Returns the address and where the text goes on, or null when there is no such part.
 */
function linkTarget(scan: InlineScan, from: number): { url: string; end: number } | null {
  const { text } = scan;
  if (text[from] !== "(") return null;
  // The first ")" after the "(", found by halving the sorted list of them rather than by reading on.
  const parens = (scan.parens ??= Array.from(text.matchAll(/\)/g), (match) => match.index!));
  let low = 0;
  let high = parens.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (parens[middle] <= from) low = middle + 1;
    else high = middle;
  }
  // An address may hold parentheses of its own ("https://en.wikipedia.org/wiki/Nut_(hardware)"): while
  // more have opened than closed, the next ")" is still part of it. A few levels are enough for any
  // real address and keep this short whatever the text holds.
  let close = parens[low];
  for (let level = 0; close !== undefined && level < 4; level += 1) {
    const inside = text.slice(from + 1, close);
    if (inside.split("(").length <= inside.split(")").length) break;
    low += 1;
    close = parens[low];
  }
  if (close === undefined) return null;
  const inside = text.slice(from + 1, close).trim();
  const url = (inside.match(/^<([^>]*)>/)?.[1] ?? inside.split(/\s+/)[0] ?? "");
  return { url, end: close + 1 };
}

/** The emphasis markers, longest first so that `**` is not read as two `*`. */
const EMPHASIS: Array<{ marker: string; type: "strong" | "em" | "del" }> = [
  { marker: "**", type: "strong" },
  { marker: "__", type: "strong" },
  { marker: "~~", type: "del" },
  { marker: "*", type: "em" },
  { marker: "_", type: "em" },
];

/**
 * An address written in angle brackets: <https://example.com> or <name@example.com>. Each part of it
 * can only be read one way (the parts of a domain cannot hold a dot), so a long address that does not
 * end in ">" fails at once instead of being tried in every split.
 */
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s<>]+|[^\s<>@]+@[^\s<>@.]+(?:\.[^\s<>@.]+)+)>/iy;

/** The characters that can start something; plain text runs up to the next one of them. */
const SPECIAL = /[\\`![<*_~]/g;

/**
 * The text of one block as inline pieces. It walks the text once; at each special character it
 * looks for the end of what that character starts, and when there is none the character is text.
 */
export function parseMarkdownInline(text: string, depth = 0): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  if (depth >= MAX_DEPTH) {
    pushText(out, text);
    return out;
  }
  const scan = inlineScan(text);
  let index = 0;
  while (index < text.length) {
    const char = text[index];

    if (char === "\\" && ESCAPABLE.includes(text[index + 1] ?? "")) {
      pushText(out, text[index + 1]);
      index += 2;
      continue;
    }

    if (char === "`") {
      // A code span ends at the same number of backticks it started with; inside it nothing is special.
      const ticks = backtickRun(text, index);
      const close = findFrom(scan, ticks, index + ticks.length);
      if (close > 0) {
        out.push({ type: "code", text: text.slice(index + ticks.length, close).replace(/^ (.+) $/, "$1") });
        index = close + ticks.length;
        continue;
      }
      pushText(out, ticks);
      index += ticks.length;
      continue;
    }

    if (char === "!" && text[index + 1] === "[") {
      const close = scan.brackets.get(index + 1);
      const target = close !== undefined ? linkTarget(scan, close + 1) : null;
      if (close !== undefined && target) {
        out.push({ type: "image", alt: text.slice(index + 2, close), src: target.url });
        index = target.end;
        continue;
      }
    }

    if (char === "[") {
      const close = scan.brackets.get(index);
      const target = close !== undefined ? linkTarget(scan, close + 1) : null;
      if (close !== undefined && target) {
        out.push({ type: "link", href: safeMarkdownHref(target.url), children: parseMarkdownInline(text.slice(index + 1, close), depth + 1) });
        index = target.end;
        continue;
      }
    }

    if (char === "<") {
      AUTOLINK.lastIndex = index;
      const autolink = AUTOLINK.exec(text);
      if (autolink) {
        const address = autolink[1];
        const href = safeMarkdownHref(address.includes(":") ? address : `mailto:${address}`);
        out.push({ type: "link", href, children: [{ type: "text", text: address }] });
        index += autolink[0].length;
        continue;
      }
    }

    const emphasis = EMPHASIS.find(({ marker }) => text.startsWith(marker, index));
    if (emphasis) {
      const { marker, type } = emphasis;
      // "_" inside a word (snake_case, file_name.md) is a letter, not emphasis.
      const insideWord = marker[0] === "_" && /[\p{L}\p{N}]/u.test(text[index - 1] ?? "");
      const opens = !insideWord && /\S/.test(text[index + marker.length] ?? "");
      const close = opens ? findClosing(scan, marker, index + marker.length) : -1;
      if (close > 0) {
        out.push({ type, children: parseMarkdownInline(text.slice(index + marker.length, close), depth + 1) });
        index = close + marker.length;
        continue;
      }
      pushText(out, marker);
      index += marker.length;
      continue;
    }

    // Plain text up to the next character that could start something.
    SPECIAL.lastIndex = index + 1;
    const end = SPECIAL.exec(text)?.index ?? text.length;
    pushText(out, text.slice(index, end));
    index = end;
  }
  return out;
}

/**
 * Where the marker that closes emphasis opened before `from` is: the next one that follows a
 * non-space and is not escaped or inside a code span; -1 when there is none. A miss is remembered
 * like `findFrom`'s, so a text full of lone `*` is still read once.
 */
function findClosing(scan: InlineScan, marker: string, from: number) {
  const key = `emphasis ${marker}`;
  const missingFrom = scan.missing.get(key);
  if (missingFrom !== undefined && from >= missingFrom) return -1;
  const { text } = scan;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") { index += 1; continue; }
    if (char === "`") {
      const ticks = backtickRun(text, index);
      const close = findFrom(scan, ticks, index + ticks.length);
      index = (close > 0 ? close : index) + ticks.length - 1;
      continue;
    }
    if (!text.startsWith(marker, index) || !/\S/.test(text[index - 1] ?? "")) continue;
    // "**" is not the end of a "*", and "_" closing inside a word is a letter.
    if (marker.length === 1 && text[index + 1] === marker) { index += 1; continue; }
    if (marker[0] === "_" && /[\p{L}\p{N}]/u.test(text[index + marker.length] ?? "")) continue;
    return index;
  }
  scan.missing.set(key, from);
  return -1;
}

// ---------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------

/*
 * The patterns that tell what a line starts. Each can be read only one way, so none of them slows
 * down on a long line made to make a pattern try every way of matching it; what would need such a
 * pattern (a heading's closing #s, a table's divider) is done in code below instead.
 */
const HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST_ITEM = /^( {0,3})([-*+]|(\d{1,9})[.)])(?:[ \t]+|$)/;

/** The cells of one table line: "| a | b |" and "a | b" both give ["a", "b"]. A "\|" stays in its cell. */
function tableCells(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

/**
 * The text of a heading line: what follows the #s, without the #s some people also close it with
 * ("## Parts ##"). Those are taken off by hand, because the pattern that would do it slows down on a
 * long line of spaces.
 */
function headingText(line: string, marks: string) {
  const text = line.slice(line.indexOf(marks) + marks.length).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  return end === 0 || text[end - 1] === " " || text[end - 1] === "\t" ? text.slice(0, end).trim() : text;
}

/**
 * Whether a line is the divider under a table's head ("|---|:---:|"): one cell of dashes, with a colon
 * at either end for the alignment, for every cell of the head.
 */
function isTableDivider(line: string | undefined, columns: number) {
  if (line === undefined || !line.includes("-")) return false;
  const cells = tableCells(line);
  return cells.length === columns && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/** Whether a line starts a block of its own, and so ends the paragraph before it. */
function startsBlock(line: string) {
  return HEADING.test(line) || FENCE.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);
}

/**
 * A whole file as blocks. Line endings of any system are accepted; a tab counts as four spaces for
 * the indentation of lists.
 */
export function parseMarkdown(source: string, depth = 0): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    // Too deep: what is left is shown as text, so nothing is lost and nothing recurses further.
    if (depth >= MAX_DEPTH) {
      blocks.push({ type: "paragraph", children: [{ type: "text", text: lines.slice(index).join("\n").trim() }] });
      break;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      // Everything up to the same fence (or the end of the file) is code, shown exactly as written.
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith(fence[1])) { code.push(lines[index]); index += 1; }
      index += 1;
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, children: parseMarkdownInline(headingText(line, heading[1]), depth) });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && lines[index].trim() && QUOTE.test(lines[index])) { quoted.push(lines[index].replace(QUOTE, "")); index += 1; }
      blocks.push({ type: "quote", children: parseMarkdown(quoted.join("\n"), depth + 1) });
      continue;
    }

    // A table: a line with "|" whose next line is a divider with as many cells.
    const head = line.includes("|") ? tableCells(line) : null;
    if (head && isTableDivider(lines[index + 1], head.length)) {
      const align = tableCells(lines[index + 1]).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      index += 2;
      const rows: MarkdownInline[][][] = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        const cells = tableCells(lines[index]);
        // Every row has as many cells as the head: missing ones are empty, extra ones are dropped.
        rows.push(head.map((_, column) => parseMarkdownInline(cells[column] ?? "", depth)));
        index += 1;
      }
      blocks.push({ type: "table", align: head.map((_, column) => align[column] ?? null), head: head.map((cell) => parseMarkdownInline(cell, depth)), rows });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      index = parseList(lines, index, depth, blocks);
      continue;
    }

    // A paragraph: the lines up to an empty one or one that starts another block.
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) { paragraph.push(lines[index].trim()); index += 1; }
    blocks.push({ type: "paragraph", children: parseMarkdownInline(paragraph.join(" "), depth) });
  }
  return blocks;
}

/**
 * A list starting at `start`, added to `blocks`; returns the line after it. An item holds its first
 * line and every line after it that is indented under it (its text goes on, or a list inside it);
 * an empty line inside the list is kept when the list goes on after it. The items' content is read
 * again as blocks, one level deeper.
 */
function parseList(lines: string[], start: number, depth: number, blocks: MarkdownBlock[]) {
  const first = LIST_ITEM.exec(lines[start])!;
  const ordered = first[3] !== undefined;
  const items: MarkdownListItem[] = [];
  let index = start;

  while (index < lines.length) {
    const marker = LIST_ITEM.exec(lines[index]);
    // Another kind of list (numbers after dashes) is another list.
    if (!marker || (marker[3] !== undefined) !== ordered) break;
    const contentIndent = marker[0].length;
    const body = [lines[index].slice(contentIndent)];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim()) {
        // Empty lines belong to the list only when the list goes on after them, indented or with
        // another item. The whole run of them is judged at once, so a file of blank lines is read once.
        let after = index + 1;
        while (after < lines.length && !lines[after].trim()) after += 1;
        if (after === lines.length || (!/^ {2,}/.test(lines[after]) && !LIST_ITEM.exec(lines[after]))) break;
        while (index < after) { body.push(""); index += 1; }
        continue;
      }
      if (LIST_ITEM.exec(next) && !/^ {2,}/.test(next)) break;
      // Indented lines belong to the item; an unindented one that starts no block goes on its paragraph.
      if (/^ {2,}/.test(next)) body.push(next.replace(new RegExp(`^ {0,${contentIndent}}`), ""));
      else if (!startsBlock(next)) body.push(next);
      else break;
      index += 1;
    }
    // "[ ] " or "[x] " at the start makes the item a task.
    const task = /^\[([ xX])\][ \t]+/.exec(body[0]);
    if (task) body[0] = body[0].slice(task[0].length);
    items.push({ checked: task ? task[1] !== " " : null, children: parseMarkdown(body.join("\n"), depth + 1) });
  }
  blocks.push({ type: "list", ordered, start: ordered ? Number(first[3]) : 1, items });
  return index;
}
