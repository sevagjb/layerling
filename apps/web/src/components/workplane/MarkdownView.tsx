"use client";

import { ImageOff } from "lucide-react";
import { createElement, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { MarkdownBlock, MarkdownInline, MarkdownListItem } from "@/lib/markdownView";

/*
 * Draws the tree `markdownView.ts` makes of a Markdown file (#820, phase 2).
 *
 * Every piece of text goes into the page as a React child, which React escapes, so whatever a file
 * says is shown as text and never read as HTML. There is no `dangerouslySetInnerHTML` here and there
 * must never be one: the parser does not make HTML, and this component does not either.
 *
 * What the parser has already decided is only drawn here:
 *   - a link the parser allowed (`href` set) opens in a new tab, with `noopener noreferrer` so that the
 *     page it opens can neither reach back into layerling nor learn where it was opened from;
 *   - a link it refused (`href` null) is its label as plain text;
 *   - a picture is its description and address, never an <img>, so nothing is fetched.
 *
 * The parser caps the nesting (`MAX_DEPTH`), and with it how deep these functions call each other.
 */

/** Runs of text: plain, code, emphasis, links and pictures. */
function renderInline(nodes: readonly MarkdownInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "del":
        return <del key={index}>{renderInline(node.children)}</del>;
      case "link":
        return node.href ? (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">{renderInline(node.children)}</a>
        ) : (
          <span key={index}>{renderInline(node.children)}</span>
        );
      case "image":
        // A stand-in that says what the picture would be; the address is in the tooltip, as text.
        return (
          <span key={index} className="markdown-image" title={t("attachments.imageNotLoaded", { address: node.src })}>
            <ImageOff aria-hidden="true" />
            {node.alt || node.src}
          </span>
        );
    }
  });
}

/**
 * One item of a list. Its first paragraph is drawn without the paragraph around it, so that the text
 * sits on the line of its bullet (or tick box) as it was written, and what follows (a list inside it,
 * say) goes below. A task gets a tick box that shows, but cannot change, what the file says.
 */
function renderListItem(item: MarkdownListItem, index: number) {
  const [first, ...rest] = item.children;
  return (
    <li key={index} className={item.checked === null ? undefined : "markdown-task"}>
      {item.checked === null ? null : <input type="checkbox" checked={item.checked} disabled readOnly tabIndex={-1} />}
      {first?.type === "paragraph" ? (
        <>
          {renderInline(first.children)}
          {renderBlocks(rest)}
        </>
      ) : (
        renderBlocks(item.children)
      )}
    </li>
  );
}

/** Blocks: headings, paragraphs, lists, quotes, code, rules and tables. */
function renderBlocks(blocks: readonly MarkdownBlock[]): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.type) {
      case "heading":
        return createElement(`h${block.level}`, { key: index }, renderInline(block.children));
      case "paragraph":
        return <p key={index}>{renderInline(block.children)}</p>;
      case "list":
        return block.ordered ? (
          <ol key={index} start={block.start === 1 ? undefined : block.start}>{block.items.map(renderListItem)}</ol>
        ) : (
          <ul key={index}>{block.items.map(renderListItem)}</ul>
        );
      case "quote":
        return <blockquote key={index}>{renderBlocks(block.children)}</blockquote>;
      case "code":
        return <pre key={index}><code>{block.text}</code></pre>;
      case "rule":
        return <hr key={index} />;
      case "table":
        // In a box of its own that scrolls sideways, so a wide table does not widen the window.
        return (
          <div key={index} className="markdown-table">
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, column) => (
                    <th key={column} style={{ textAlign: block.align[column] ?? undefined }}>{renderInline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, column) => (
                      <td key={column} style={{ textAlign: block.align[column] ?? undefined }}>{renderInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** A parsed Markdown file, drawn as formatted text. */
export function MarkdownView({ blocks }: { blocks: readonly MarkdownBlock[] }) {
  return <div className="markdown-view">{renderBlocks(blocks)}</div>;
}
