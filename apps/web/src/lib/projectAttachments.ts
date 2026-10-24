import { createLocalId } from "@/lib/localIds";
import { sha256Hex } from "@/lib/projectAssets";
import type { ProjectAttachment } from "@/types/layerling";

/*
 * Files kept with a design (#820): instructions, a parts list, a readme.
 *
 * An attachment is an ordinary file the user uploads. It is saved in the design's `.lyl` package
 * (format version 3, see `lylProject.ts`), so it travels with the design: in the browser, in an
 * exported file, in a backup and in the server folder. It is not part of the undo history.
 *
 * This module is the one place that decides what an attachment is. Everything that touches one asks
 * it, so the answer cannot differ between them:
 *
 *   - the attachments panel (`AttachmentsPanel.tsx`), when a file is uploaded or renamed,
 *   - the `.lyl` format (`lylProject.ts`), when a package is written and when one is opened,
 *   - the AI bridge (`projectAttachmentsMcp.ts`), when an agent lists, reads, adds, renames or removes one.
 *
 * What it covers, in order:
 *   1. the limits,
 *   2. why a file or a list is refused,
 *   3. the table of file types that may be attached,
 *   4. names: cleaning them, comparing them, finding a free one,
 *   5. checks on a file and on a whole list,
 *   6. making an attachment from a file's bytes, and the list operations (add, replace, remove).
 *
 * Nothing here touches the browser, the editor or React: the functions take values and return values,
 * which is what keeps them easy to test (`tests/unit/projectAttachments.test.ts`).
 */

// ---------------------------------------------------------------------------------------------
// 1. Limits
// ---------------------------------------------------------------------------------------------

/**
 * How much a design may carry. The numbers are small on purpose: the attachments are packed into the
 * design's package and so go through every save of it - the one in the browser after each change, the
 * one to the server folder, every export. A file of a few kilobytes is what instructions and a parts
 * list are; a megabyte of text is already a book.
 */
export const ATTACHMENT_LIMITS = {
  /** One file, in bytes. */
  fileBytes: 2 * 1024 * 1024,
  /** Files in one design. */
  files: 16,
  /** All files of one design together, in bytes. */
  totalBytes: 8 * 1024 * 1024,
  /** Characters in a file name, extension included. */
  nameLength: 120,
} as const;

// ---------------------------------------------------------------------------------------------
// 2. Why a file or a list is refused
// ---------------------------------------------------------------------------------------------

/**
 * Every reason this module has for refusing something, as a code. The code is what callers compare
 * and what the panel turns into a sentence in the user's language; `attachmentProblemText` gives the
 * English sentence for the places that have only an `Error` to throw.
 *
 *   - `name`      the name is empty, has a folder in it, or has no extension to speak of
 *   - `type`      the extension is not one that may be attached
 *   - `empty`     the file has no bytes
 *   - `tooBig`    the file is over `ATTACHMENT_LIMITS.fileBytes`
 *   - `notText`   the file is called text but is not (a binary file renamed to ".txt", say)
 *   - `tooMany`   the list would hold more than `ATTACHMENT_LIMITS.files` files
 *   - `tooMuch`   the list would hold more than `ATTACHMENT_LIMITS.totalBytes` bytes
 *   - `nameTaken` another file of the list already has this name
 */
export type AttachmentProblem = "name" | "type" | "empty" | "tooBig" | "notText" | "tooMany" | "tooMuch" | "nameTaken";

/**
 * Thrown where a refused file or list has to stop a calculation. It keeps the code, so a caller that
 * can show something better than the English message (the panel can) looks at `problem`.
 */
export class AttachmentError extends Error {
  constructor(readonly problem: AttachmentProblem, readonly fileName?: string) {
    super(attachmentProblemText(problem, fileName));
    this.name = "AttachmentError";
  }
}

/** The English sentence for a problem, naming the file when there is one. The panel has its own, translated. */
export function attachmentProblemText(problem: AttachmentProblem, fileName?: string) {
  const file = fileName ? `'${fileName}'` : "The file";
  switch (problem) {
    case "name": return `${file} has no usable name`;
    case "type": return `${file} is not a type of file that can be attached`;
    case "empty": return `${file} is empty`;
    case "tooBig": return `${file} is larger than ${ATTACHMENT_LIMITS.fileBytes / (1024 * 1024)} MB`;
    case "notText": return `${file} is not plain UTF-8 text`;
    case "tooMany": return `A design holds at most ${ATTACHMENT_LIMITS.files} attachments`;
    case "tooMuch": return `The attachments of a design hold at most ${ATTACHMENT_LIMITS.totalBytes / (1024 * 1024)} MB together`;
    case "nameTaken": return `${file} is already attached`;
  }
}

// ---------------------------------------------------------------------------------------------
// 3. The file types that may be attached
// ---------------------------------------------------------------------------------------------

/**
 * A text check: UTF-8 that holds no NUL byte. Decoding with `fatal: true` makes the decoder throw on
 * any byte sequence that is not valid UTF-8; the NUL test catches what UTF-8 allows but no text file
 * has, which is what a binary file (a picture, a program) nearly always contains somewhere.
 */
function textProblem(bytes: Uint8Array): AttachmentProblem | null {
  if (bytes.includes(0)) return "notText";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return null;
  } catch {
    return "notText";
  }
}

/** One kind of file that may be attached. */
export type AttachmentType = {
  /** In lower case and without the dot. */
  extension: string;
  /** What the package records the file as, and what a download is given as its type. */
  mediaType: string;
  /**
   * What the bytes have to be for the extension to be true: null when they are, otherwise the problem.
   * A file is never trusted by its name alone - a name is easy to fake - so every type brings its own check.
   */
  check: (bytes: Uint8Array) => AttachmentProblem | null;
  /**
   * How the attachment viewer shows the file: "markdown" formatted (`markdownView.ts`), "text" as it is.
   * A type without it gets no View button in the panel, only Download.
   */
  view?: AttachmentView;
};

/** The ways the attachment viewer can show a file. */
export type AttachmentView = "markdown" | "text";

/**
 * Every type that may be attached, one row each. This table is the whole definition of "may be
 * attached": the format reads it to accept or refuse a package, the panel reads it for the file
 * chooser and for its messages. Another type is another row (and a `check` that fits it); nothing
 * else has to change.
 */
export const ATTACHMENT_TYPES: readonly AttachmentType[] = [
  { extension: "md", mediaType: "text/markdown", check: textProblem, view: "markdown" },
  { extension: "txt", mediaType: "text/plain", check: textProblem, view: "text" },
];

/** The lower-case extension of a file name, or "" when there is none ("README", ".md" alone). */
function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

/** The type a file name belongs to, going by its extension, or undefined when it is not one that may be attached. */
export function attachmentTypeForFileName(fileName: string) {
  const extension = extensionOf(fileName);
  return ATTACHMENT_TYPES.find((type) => type.extension === extension);
}

/** The type that goes by this media type; how a package's records are matched back to the table. */
export function attachmentTypeForMediaType(mediaType: string) {
  return ATTACHMENT_TYPES.find((type) => type.mediaType === mediaType);
}

/**
 * How the viewer shows an attachment, or undefined when it cannot show it. It goes by the media type the
 * design recorded, which the format only accepts when it is a row of the table above.
 */
export function attachmentView(attachment: Pick<ProjectAttachment, "mediaType">): AttachmentView | undefined {
  return attachmentTypeForMediaType(attachment.mediaType)?.view;
}

/** The extensions that may be attached, ".md,.txt" for the `accept` of a file chooser or ".md, .txt" for a sentence. */
export function attachmentAcceptList(separator = ",") {
  return ATTACHMENT_TYPES.map((type) => `.${type.extension}`).join(separator);
}

// ---------------------------------------------------------------------------------------------
// 4. Names
// ---------------------------------------------------------------------------------------------

/**
 * A name as it is kept in the design:
 *   - no folder in front ("C:\Users\me\notes.md" and "../notes.md" both become "notes.md"), so a name
 *     can never point anywhere when it is used as a file name in a download;
 *   - no control characters, and runs of white space become one space;
 *   - at most `ATTACHMENT_LIMITS.nameLength` characters, cut from the part before the extension so the
 *     extension - which decides the type - always survives.
 * Returns "" when nothing usable is left.
 */
export function cleanAttachmentName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= ATTACHMENT_LIMITS.nameLength) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, ATTACHMENT_LIMITS.nameLength - extension.length).trimEnd() + extension;
}

/**
 * What two names are compared by: their lower-case form. "Notes.MD" and "notes.md" are the same file
 * here, because on the computers that open the design (Windows and macOS file systems) they are, and
 * a download of one would overwrite the other.
 */
function nameKey(name: string) {
  return name.toLowerCase();
}

/**
 * Why a name cannot be used for an attachment, or null if it can. `taken` are the names of the other
 * files in the design. A name that would change when cleaned (`cleanAttachmentName`) is refused as it
 * stands, not silently changed: callers that accept what a user typed clean it first.
 */
export function attachmentNameProblem(name: string, taken: readonly string[] = []): AttachmentProblem | null {
  const cleaned = cleanAttachmentName(name);
  const dot = cleaned.lastIndexOf(".");
  // "dot < 1" is a name without an extension, or one that is only an extension (".md").
  if (!cleaned || cleaned !== name || dot < 1) return "name";
  if (!attachmentTypeForFileName(cleaned)) return "type";
  return taken.some((other) => nameKey(other) === nameKey(cleaned)) ? "nameTaken" : null;
}

/** The attachment of the list with this name (compared without regard to case), if there is one. */
export function findAttachmentByName(attachments: readonly ProjectAttachment[], name: string) {
  return attachments.find((attachment) => nameKey(attachment.name) === nameKey(name));
}

/**
 * The name itself when no attachment has it, else the first of "name 2.ext", "name 3.ext" ... that no
 * attachment has. The number goes before the extension so the type stays what it was.
 *
 *     freeAttachmentName([notes.md, notes 2.md], "notes.md")  ->  "notes 3.md"
 */
export function freeAttachmentName(attachments: readonly ProjectAttachment[], name: string) {
  const cleaned = cleanAttachmentName(name);
  if (!findAttachmentByName(attachments, cleaned)) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const extension = dot > 0 ? cleaned.slice(dot) : "";
  for (let number = 2; ; number += 1) {
    const candidate = cleanAttachmentName(`${stem} ${number}${extension}`);
    if (!findAttachmentByName(attachments, candidate)) return candidate;
  }
}

// ---------------------------------------------------------------------------------------------
// 5. Checks
// ---------------------------------------------------------------------------------------------

/**
 * Why this file cannot be attached under this name, or null if it can. Looks at the file alone, not
 * at what else is attached: a name that is taken is a different question (`findAttachmentByName`).
 * Cheap checks come first, so a file of the wrong type is refused before its bytes are read.
 */
export function attachmentFileProblem(name: string, bytes: Uint8Array): AttachmentProblem | null {
  const problem = attachmentNameProblem(name);
  if (problem) return problem;
  if (bytes.byteLength === 0) return "empty";
  if (bytes.byteLength > ATTACHMENT_LIMITS.fileBytes) return "tooBig";
  const type = attachmentTypeForFileName(name);
  return type ? type.check(bytes) : "type";
}

/** Why this many files of this size cannot be kept together, or null. Only sizes are looked at, so it also serves a package's records. */
export function attachmentCountProblem(attachments: readonly Pick<ProjectAttachment, "byteLength">[]): AttachmentProblem | null {
  if (attachments.length > ATTACHMENT_LIMITS.files) return "tooMany";
  return attachments.reduce((total, attachment) => total + attachment.byteLength, 0) > ATTACHMENT_LIMITS.totalBytes ? "tooMuch" : null;
}

/**
 * Why a whole list is not acceptable - a name that cannot be used or is there twice, too many files,
 * too much of them - or null. It names the file at fault when there is one.
 *
 * This is what a `.lyl` file is checked with on the way in and on the way out: a package is never
 * written that would not open again, and one that was changed by hand is refused when it is opened.
 */
export function attachmentListProblem(attachments: readonly Pick<ProjectAttachment, "name" | "byteLength">[]): { problem: AttachmentProblem; fileName?: string } | null {
  const seen = new Set<string>();
  for (const attachment of attachments) {
    const problem = attachmentNameProblem(attachment.name);
    if (problem) return { problem, fileName: attachment.name };
    if (seen.has(nameKey(attachment.name))) return { problem: "nameTaken", fileName: attachment.name };
    seen.add(nameKey(attachment.name));
  }
  const problem = attachmentCountProblem(attachments);
  return problem ? { problem } : null;
}

/**
 * The files of a design as one line of text, for the saves that look for a change: a design without
 * attachments gives an empty line, so adding this to a fingerprint changes nothing for it. The hash
 * stands for the content, so a file replaced by another of the same name and size still counts as a change.
 */
export function attachmentsFingerprint(attachments: readonly ProjectAttachment[]) {
  return attachments.map((attachment) => `${attachment.id}:${attachment.name}:${attachment.sha256}`).join("|");
}

// ---------------------------------------------------------------------------------------------
// 6. Making an attachment, and the list operations
// ---------------------------------------------------------------------------------------------

/**
 * A file the user chose, ready to attach: its name cleaned, its content checked, its type and hash
 * worked out. The bytes are copied, so the attachment does not change if the caller reuses its buffer.
 * Throws an `AttachmentError` when the file may not be attached.
 *
 * `id` is what the attachment is known by inside the design - it stays the same when the file is
 * replaced or renamed - and is made here unless the caller has one (a replacement keeps its own).
 */
export async function projectAttachmentFromBytes(fileName: string, bytes: Uint8Array, id = createLocalId("attachment")): Promise<ProjectAttachment> {
  const name = cleanAttachmentName(fileName);
  const problem = attachmentFileProblem(name, bytes);
  if (problem) throw new AttachmentError(problem, name || fileName);
  const copy = new Uint8Array(bytes);
  return {
    id,
    name,
    // The check above has passed, so the type exists.
    mediaType: (attachmentTypeForFileName(name) as AttachmentType).mediaType,
    bytes: copy,
    byteLength: copy.byteLength,
    sha256: await sha256Hex(copy),
  };
}

/*
 * The list operations below return a new list and never change the one they are given, so a caller
 * can hold the old list while it decides, and React sees a new value.
 */

/**
 * The list with `attachment` added at the end. A name that is already there is for the caller to
 * settle first (`findAttachmentByName`): replace the one that is there, or give the new one another
 * name. Throws an `AttachmentError` when the name is taken or the list would outgrow its limits.
 */
export function withAttachmentAdded(attachments: readonly ProjectAttachment[], attachment: ProjectAttachment) {
  if (findAttachmentByName(attachments, attachment.name)) throw new AttachmentError("nameTaken", attachment.name);
  const next = [...attachments, attachment];
  const problem = attachmentCountProblem(next);
  if (problem) throw new AttachmentError(problem);
  return next;
}

/**
 * The list with the attachment `id` replaced where it stands: it keeps its place and its id, and takes
 * the new name, bytes and type. The limits are checked on the result, so a replacement only counts the
 * bytes it adds. Throws an `AttachmentError` when the new name is another file's, or the result is too big.
 */
export function withAttachmentReplaced(attachments: readonly ProjectAttachment[], id: string, attachment: ProjectAttachment) {
  const other = findAttachmentByName(attachments, attachment.name);
  if (other && other.id !== id) throw new AttachmentError("nameTaken", attachment.name);
  const next = attachments.map((entry) => (entry.id === id ? { ...attachment, id } : entry));
  const problem = attachmentCountProblem(next);
  if (problem) throw new AttachmentError(problem);
  return next;
}

/** The list without the attachment `id`. An id that is not there changes nothing. */
export function withAttachmentRemoved(attachments: readonly ProjectAttachment[], id: string) {
  return attachments.filter((attachment) => attachment.id !== id);
}
