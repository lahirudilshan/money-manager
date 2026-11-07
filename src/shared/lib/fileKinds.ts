/**
 * What kind of file an attachment is, read from its extension.
 *
 * Attachments used to be photos or PDFs, and `isPdfAttachment` was enough.
 * The Documents add-on accepts anything Files can hand over — a Word contract,
 * a spreadsheet of warranty serials, a scanned deed — so the screens need one
 * place that says how each is drawn (tile colour, icon, label) and how it is
 * opened (an image reader, or WebKit, which renders PDF, Office and text
 * natively on iOS).
 *
 * Pure: no React, no file system. The extension is always what decides,
 * because `persistPickedFile` keeps the original one on every copy.
 */

export type FileKind =
  | 'image'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'text'
  | 'audio'
  | 'video'
  | 'archive'
  | 'other';

const BY_EXTENSION: Record<string, FileKind> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  heic: 'image',
  heif: 'image',
  gif: 'image',
  webp: 'image',
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  pages: 'doc',
  rtf: 'doc',
  odt: 'doc',
  xls: 'sheet',
  xlsx: 'sheet',
  numbers: 'sheet',
  csv: 'sheet',
  ods: 'sheet',
  ppt: 'slides',
  pptx: 'slides',
  key: 'slides',
  odp: 'slides',
  txt: 'text',
  md: 'text',
  json: 'text',
  html: 'text',
  mp3: 'audio',
  m4a: 'audio',
  wav: 'audio',
  aac: 'audio',
  mp4: 'video',
  mov: 'video',
  m4v: 'video',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
};

/** The extension of a path or file name, lower case, without the dot. */
export function extensionOf(pathOrName: string | null | undefined): string {
  if (!pathOrName) return '';
  // A stored reference may be "drive:abc|file:///…/x.pdf" — the path is last.
  const last = pathOrName.split('|').pop() ?? '';
  const clean = last.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot < clean.lastIndexOf('/')) return '';
  const ext = clean.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

/**
 * A safe extension to persist a picked file under.
 *
 * Anything odd becomes `bin` rather than being trusted into a file name.
 */
export function safeExtension(pathOrName: string | null | undefined, fallback = 'bin'): string {
  return extensionOf(pathOrName) || fallback;
}

export function fileKindOf(pathOrName: string | null | undefined): FileKind {
  return BY_EXTENSION[extensionOf(pathOrName)] ?? 'other';
}

/** The MIME type Drive should store a file as. */
export function mimeTypeFor(pathOrName: string | null | undefined): string | null {
  const ext = extensionOf(pathOrName);
  const known: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    html: 'text/html',
    rtf: 'application/rtf',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    zip: 'application/zip',
  };
  return known[ext] ?? null;
}

/** The short word on a tile: "PDF", "DOCX", "Photo". */
export function fileBadge(pathOrName: string | null | undefined): string {
  const kind = fileKindOf(pathOrName);
  if (kind === 'image') return 'Photo';
  const ext = extensionOf(pathOrName);
  return ext ? ext.toUpperCase() : 'File';
}

/** The human name of a kind, for filters and the preview's details. */
export const FILE_KIND_LABEL: Record<FileKind, string> = {
  image: 'Photo',
  pdf: 'PDF',
  doc: 'Document',
  sheet: 'Spreadsheet',
  slides: 'Presentation',
  text: 'Text',
  audio: 'Audio',
  video: 'Video',
  archive: 'Archive',
  other: 'File',
};

/** "2.4 MB", "820 KB". Null in, null out — an unknown size is "Not set". */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
