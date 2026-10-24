"use client";

import { Check, Download, Eye, FileText, Trash2, Upload, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { formatFileSize } from "@/lib/formatFileSize";
import { t, type MessageKey } from "@/lib/i18n";
import {
  ATTACHMENT_LIMITS,
  AttachmentError,
  attachmentAcceptList,
  attachmentNameProblem,
  attachmentView,
  cleanAttachmentName,
  findAttachmentByName,
  freeAttachmentName,
  projectAttachmentFromBytes,
  withAttachmentAdded,
  withAttachmentRemoved,
  withAttachmentReplaced,
  type AttachmentProblem,
} from "@/lib/projectAttachments";
import type { ProjectAttachment } from "@/types/layerling";

/** The message that says each problem in the user's language; the codes themselves come from `projectAttachments.ts`. */
const PROBLEM_KEYS: Record<AttachmentProblem, MessageKey> = {
  name: "attachments.problem.name",
  type: "attachments.problem.type",
  empty: "attachments.problem.empty",
  tooBig: "attachments.problem.tooBig",
  notText: "attachments.problem.notText",
  tooMany: "attachments.problem.tooMany",
  tooMuch: "attachments.problem.tooMuch",
  nameTaken: "attachments.problem.nameTaken",
};

/**
 * Why a file or a name is refused, in the user's language. The same values go into every sentence;
 * each message uses the ones it has a place for ({name}, {types}, {size}, {files}, {total}).
 */
function problemText(problem: AttachmentProblem, name = "") {
  return t(PROBLEM_KEYS[problem], {
    name,
    types: attachmentAcceptList(", "),
    size: ATTACHMENT_LIMITS.fileBytes / (1024 * 1024),
    files: ATTACHMENT_LIMITS.files,
    total: ATTACHMENT_LIMITS.totalBytes / (1024 * 1024),
  });
}

/**
 * A file the user chose whose name is already attached, with different content, waiting to be
 * settled. The bytes are kept so that "replace" and "rename" can still make the attachment later.
 */
type WaitingFile = { name: string; bytes: Uint8Array };

/**
 * The files kept with the design (#820).
 *
 * What the user sees, top to bottom:
 *   1. an Upload button (the same button as the Import panel's), which opens the file chooser;
 *   2. a prompt, only while a chosen file has the name of one that is attached already;
 *   3. the list of attached files, each with Download and Remove, and View for the types the viewer
 *      can show (Markdown and text, `view` in the type table);
 *   4. a line with the limits.
 *
 * A file whose name is already attached is not added silently and not turned away: the user is asked
 * to replace the attached one, to give the new one another name, or to leave it. When several files
 * are chosen at once, those without a clash are added straight away and the others wait in a queue
 * that the prompt works through one by one.
 *
 * What this component keeps for itself is only what belongs to the moment: the queue of files
 * waiting, the name being typed, and which row asks "Remove?". The list of attachments belongs to the
 * editor (it is saved with the design); this component only asks it to change, through `onChange`,
 * and always with a whole new list.
 */
export function AttachmentsPanel({
  attachments,
  locked,
  onChange,
  onDownload,
  onView,
  onNotice,
}: {
  /** The files kept with the design, in the order they are listed. */
  attachments: readonly ProjectAttachment[];
  /** Uploading and removing are off while the history view shows an earlier state. */
  locked: boolean;
  /** Asks the editor to keep this list instead; it is saved with the design. */
  onChange: (next: ProjectAttachment[]) => void;
  /** Saves one attachment as a file on the user's computer. */
  onDownload: (attachment: ProjectAttachment) => void;
  /** Opens the attachment viewer on one attachment. Only offered for the types it can show. */
  onView: (attachment: ProjectAttachment) => void;
  /** Says something at the bottom of the editor: what was done, or why a file was refused. */
  onNotice: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  /** Files that clash with an attached name, oldest first. The prompt always shows the first. */
  const [waiting, setWaiting] = useState<WaitingFile[]>([]);
  /** The name being typed in the prompt's rename field, or null while the prompt shows its three buttons. */
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  /** The id of the attachment whose row asks "Remove?", if any. */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  /**
   * What happens when files are chosen. Each is read and checked in turn:
   *   - a file that may not be attached is refused with a notice and the others carry on;
   *   - a file whose name is free is added;
   *   - a file whose name is taken and whose content is the same changes nothing, and says so;
   *   - a file whose name is taken and whose content differs joins the queue for the prompt.
   * The files that were added are handed to the editor in one go, so one upload is one change.
   */
  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // The list as it grows while the chosen files are read one after the other: a second file with the
    // same name as the first one chosen has to see the first.
    let list: readonly ProjectAttachment[] = attachments;
    const clashes: WaitingFile[] = [];
    let added = 0;
    let lastName = "";
    for (const file of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const attachment = await projectAttachmentFromBytes(file.name, bytes);
        const attached = findAttachmentByName(list, attachment.name);
        if (attached) {
          // The same file again is nothing to decide.
          if (attached.sha256 === attachment.sha256) onNotice(t("attachments.unchanged", { name: attached.name }));
          else clashes.push({ name: attachment.name, bytes });
          continue;
        }
        list = withAttachmentAdded(list, attachment);
        added += 1;
        lastName = attachment.name;
      } catch (error) {
        onNotice(error instanceof AttachmentError ? problemText(error.problem, error.fileName ?? file.name) : t("attachments.readFailed", { name: file.name }));
      }
    }
    if (added > 0) {
      onChange([...list]);
      onNotice(added === 1 ? t("attachments.added", { name: lastName }) : t("attachments.addedMany", { count: added }));
    }
    if (clashes.length > 0) setWaiting((current) => [...current, ...clashes]);
  };

  /**
   * Settles the file at the front of the queue, as the user chose in the prompt:
   *   - "replace": the attached file of that name gets the new content, keeping its place, id and name;
   *   - "rename": the file is added under `name`, the name typed in the prompt;
   *   - "leave": the file is dropped and the list stays as it is.
   * The attachment is made again here from the kept bytes, so a rename to another extension is
   * checked as the other type it has become.
   */
  const settle = async (action: "replace" | "rename" | "leave", name = "") => {
    const [file, ...rest] = waiting;
    if (!file) return;
    setWaiting(rest);
    setRenameDraft(null);
    if (action === "leave") return;
    try {
      const wanted = action === "rename" ? name : file.name;
      // A replaced file keeps the name it has in the design, whatever case the new one was written in.
      const attached = findAttachmentByName(attachments, wanted);
      const attachment = await projectAttachmentFromBytes(attached?.name ?? wanted, file.bytes);
      onChange(attached ? withAttachmentReplaced(attachments, attached.id, attachment) : withAttachmentAdded(attachments, attachment));
      onNotice(t(attached ? "attachments.replaced" : "attachments.added", { name: attachment.name }));
    } catch (error) {
      onNotice(error instanceof AttachmentError ? problemText(error.problem, error.fileName) : t("attachments.readFailed", { name: file.name }));
    }
  };

  /** Takes the attachment out of the design. There is no undo for this - attachments are not part of the history - hence the question in the row first. */
  const removeAttachment = (attachment: ProjectAttachment) => {
    setConfirmRemove(null);
    onChange(withAttachmentRemoved(attachments, attachment.id));
    onNotice(t("attachments.removed", { name: attachment.name }));
  };

  // The prompt's rename field: what is typed is cleaned the way a name is kept, and judged against the
  // other names. A problem marks the field and switches the confirm button off; the reason is its tooltip.
  const front = waiting[0];
  const draftName = renameDraft === null ? "" : cleanAttachmentName(renameDraft);
  const renameProblem = renameDraft === null ? null : attachmentNameProblem(draftName, attachments.map((attachment) => attachment.name));
  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (renameProblem) return;
    void settle("rename", draftName);
  };

  return (
    <div className="top-action-body attachments-panel">
      {/* The upload button looks and sits as the Import panel's; the real file input is hidden and opened by it. */}
      <button className="open-lyl-project-button" type="button" onClick={() => inputRef.current?.click()} disabled={locked} data-testid="attachments-upload">
        <span className="open-lyl-project-icon"><Upload size={18} /></span>
        <span>
          <strong>{t("attachments.upload")}</strong>
          <small>{t("attachments.uploadHint")}</small>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={attachmentAcceptList()}
        multiple
        hidden
        onChange={(event) => {
          void addFiles(event.currentTarget.files);
          // Emptied, so that choosing the same file again (after fixing it, say) is a change the browser reports.
          event.currentTarget.value = "";
        }}
      />
      {front ? (
        // The name clash. Its buttons are the small ones of the My shapes list; "Replace" is red like the
        // list's "Delete?" because the attached file's content is gone afterwards.
        <div className="attachment-clash" role="group" aria-label={t("attachments.nameTaken", { name: front.name })}>
          <p>
            {t("attachments.nameTaken", { name: front.name })}
            {waiting.length > 1 ? <small>{t("attachments.waitingMore", { count: waiting.length - 1 })}</small> : null}
          </p>
          {renameDraft === null ? (
            <div className="attachment-clash-actions">
              <button type="button" className="my-shape-tile-action danger" onClick={() => void settle("replace")}>{t("attachments.replace")}</button>
              <button type="button" className="my-shape-tile-action" onClick={() => setRenameDraft(freeAttachmentName(attachments, front.name))}>{t("common.rename")}</button>
              <button type="button" className="my-shape-tile-action" aria-label={t("common.cancel")} title={t("common.cancel")} onClick={() => void settle("leave")}>
                <X aria-hidden="true" />
              </button>
            </div>
          ) : (
            <form className="attachment-rename" onSubmit={submitRename}>
              <input
                autoFocus
                value={renameDraft}
                aria-label={t("attachments.fileName")}
                aria-invalid={renameProblem ? true : undefined}
                title={renameProblem ? problemText(renameProblem, draftName) : undefined}
                onChange={(event) => setRenameDraft(event.currentTarget.value)}
              />
              <button type="submit" className="my-shape-tile-action" aria-label={t("common.rename")} title={t("common.rename")} disabled={Boolean(renameProblem)}>
                <Check aria-hidden="true" />
              </button>
              <button type="button" className="my-shape-tile-action" aria-label={t("common.cancel")} title={t("common.cancel")} onClick={() => setRenameDraft(null)}>
                <X aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      ) : null}
      {attachments.length === 0 ? (
        <p className="attachments-note">{t("attachments.empty")}</p>
      ) : (
        <ul className="attachments-list" aria-label={t("panel.attachments")}>
          {attachments.map((attachment) => (
            <li key={attachment.id} className="attachment-row">
              <FileText aria-hidden="true" />
              {/* translate="no": a file name is not text to be translated by the browser. */}
              <span className="attachment-name" translate="no" title={attachment.name}>{attachment.name}</span>
              <small>{formatFileSize(attachment.byteLength)}</small>
              <span className="attachment-actions">
                {confirmRemove === attachment.id ? (
                  // The row asks before it removes, the way a row of the My shapes list does.
                  <>
                    <button type="button" className="my-shape-tile-action danger" onClick={() => removeAttachment(attachment)}>{t("attachments.removeConfirm")}</button>
                    <button type="button" className="my-shape-tile-action" aria-label={t("common.cancel")} title={t("common.cancel")} onClick={() => setConfirmRemove(null)}>
                      <X aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <>
                    {/* View only reads, so it stays on in the History view, like Download. */}
                    {attachmentView(attachment) ? (
                      <button type="button" className="my-shape-tile-action" aria-label={t("attachments.view", { name: attachment.name })} title={t("attachments.view", { name: attachment.name })} onClick={() => onView(attachment)}>
                        <Eye aria-hidden="true" />
                      </button>
                    ) : null}
                    <button type="button" className="my-shape-tile-action" aria-label={t("attachments.download", { name: attachment.name })} title={t("attachments.download", { name: attachment.name })} onClick={() => onDownload(attachment)}>
                      <Download aria-hidden="true" />
                    </button>
                    <button type="button" className="my-shape-tile-action" aria-label={t("attachments.remove", { name: attachment.name })} title={t("attachments.remove", { name: attachment.name })} disabled={locked} onClick={() => setConfirmRemove(attachment.id)}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="attachments-note">{t("attachments.limits", { types: attachmentAcceptList(", "), files: ATTACHMENT_LIMITS.files, size: ATTACHMENT_LIMITS.fileBytes / (1024 * 1024), total: ATTACHMENT_LIMITS.totalBytes / (1024 * 1024) })}</p>
    </div>
  );
}
