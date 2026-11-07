import { describe, expect, it } from 'vitest';
import { attachmentPlacement, safeName, type PendingImage } from '~/features/backup/logic/imageSync';
import { escapeDriveQuery, findChildFolderRequest } from '~/features/backup/logic/driveSync';

const pending = (table: PendingImage['table'], localUri: string): PendingImage => ({
  table,
  rowId: 'abc123def456',
  stored: localUri,
  localUri,
});

describe('where attachments go in Drive', () => {
  it('files a report by person, kind and year, named by date and title', () => {
    expect(
      attachmentPlacement(pending('health_documents', 'file:///x/1.pdf'), {
        title: 'Lipid profile · Asiri Labs',
        kind: 'report',
        documentDate: new Date(2026, 2, 14),
        personName: "Amma's",
      }),
    ).toEqual({
      folders: ['Health', "Amma's", 'Lab reports', '2026'],
      filename: '2026-03-14 Lipid profile · Asiri Labs (abc123).pdf',
    });
  });

  it('keeps other attachments in the flat folder', () => {
    expect(attachmentPlacement(pending('transactions', 'file:///x/1.jpg'))).toEqual({
      folders: ['attachments'],
      filename: 'transactions-abc123def456.jpg',
    });
  });

  it('cleans names Drive and Files handle badly', () => {
    expect(safeName('a/b:c*?  d')).toBe('a b c d');
    expect(safeName('   ')).toBe('Untitled');
  });

  it('escapes quotes in folder searches', () => {
    expect(escapeDriveQuery("Amma's")).toBe("Amma\\'s");
    const q = new URL(findChildFolderRequest('t', 'p', "Amma's").url).searchParams.get('q');
    expect(q).toContain("name='Amma\\'s'");
  });
});

describe('documents add-on placement', () => {
  it("mirrors the user's own folders under Documents and keeps the extension", () => {
    const placed = attachmentPlacement(
      { table: 'doc_files', rowId: 'abcdef123', stored: 'file:///x/1.docx', localUri: 'file:///x/1.docx' },
      undefined,
      { title: 'Lease: 2026', folderPath: ['Home', 'Rent'] },
    );
    expect(placed.folders).toEqual(['Documents', 'Home', 'Rent']);
    expect(placed.filename).toBe('Lease 2026 (abcdef).docx');
  });
});
