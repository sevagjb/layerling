"use client";

import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { MarkdownView } from "@/components/workplane/MarkdownView";
import { t } from "@/lib/i18n";
import { parseMarkdown } from "@/lib/markdownView";
import { attachmentView } from "@/lib/projectAttachments";
import { useMovablePanel } from "@/lib/useMovablePanel";
import type { ProjectAttachment } from "@/types/layerling";

/**
 * Shows one attachment of the design to read (#820, phase 2): a Markdown file formatted, a text file as
 * it is. It is opened from the eye button of a row in the attachments panel.
 *
 * The window is the quick guide's (`GuideModal.tsx`): the same card, title bar and backdrop, moved by
 * its title bar and remembered where it stood. It only reads, so it also opens while the History view
 * shows an earlier state, as Download does.
 *
 * It can be closed at any time, the way the guide is: the X in the title bar, Escape, or a click beside
 * the window. The editor also stops showing it by itself when the file is no longer in the design
 * (removed, or another design opened), since it only draws what it is handed.
 *
 * Why this is safe to show, whatever the file says: the text is decoded here and handed to React as
 * text. A Markdown file goes through `parseMarkdown`, which makes a tree and never HTML, and
 * `MarkdownView` draws that tree as elements; links open only to web pages and e-mail addresses, in a
 * new tab, and pictures are not loaded. The comments of those two files say why.
 */
export function AttachmentViewer({ attachment, onClose }: { attachment: ProjectAttachment; onClose: () => void }) {
  const view = attachmentView(attachment);
  // Decoded and parsed once per file content, not on every move of the window. The bytes were checked to
  // be UTF-8 when they were attached; a byte-order mark at the start is dropped by the decoder.
  const text = useMemo(() => new TextDecoder("utf-8").decode(attachment.bytes), [attachment.bytes]);
  const blocks = useMemo(() => (view === "markdown" ? parseMarkdown(text) : null), [text, view]);
  const movable = useMovablePanel<HTMLDivElement>("layerling.editor.attachmentViewerPosition", { floatingStyle: { position: "absolute", margin: 0 } });
  const cardRef = movable.panelRef;

  // The card takes the focus, so that Escape and the arrow keys (to scroll) reach it straight away.
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  return (
    <div
      className="workspace-modal shortcuts-modal attachment-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      // Editor and viewport both listen for keys on the window; while a file is being read, its keys
      // must not also move or delete parts of the design.
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div
        className={`workspace-modal-card shortcuts-modal-card ${movable.moved ? "floating" : ""} ${movable.dragging ? "moving" : ""}`}
        ref={cardRef}
        style={movable.style}
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="workspace-modal-header movable" title={t("panel.moveHint")} {...movable.handleProps}>
          {/* translate="no": a file name is not text to be translated by the browser. */}
          <strong translate="no" title={attachment.name}>{attachment.name}</strong>
          <button aria-label={t("attachments.viewerClose", { name: attachment.name })} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="workspace-modal-content">
          <div className="workspace-modal-body attachment-viewer-body">
            {blocks ? <MarkdownView blocks={blocks} /> : <pre className="attachment-viewer-text">{text}</pre>}
          </div>
          {blocks ? <div className="workspace-modal-footer">{t("attachments.viewerFooter")}</div> : null}
        </div>
      </div>
      <button className="workspace-modal-backdrop" aria-label={t("attachments.viewerClose", { name: attachment.name })} onClick={onClose} />
    </div>
  );
}
