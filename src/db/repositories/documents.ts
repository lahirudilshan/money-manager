/** Documents add-on: nested folders and the files kept in them. */

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '~/db/client';
import {
  docFiles,
  docFolders,
  type DocFile,
  type DocFolder,
  type NewDocFile,
  type NewDocFolder,
} from '~/db/schema';
import { descendantIds } from '~/features/documents/logic/folders';
import { deletePersistedImage } from '~/shared/lib/imageStorage';
import { createId, liveOnly, now, tombstone } from './internal';

/**
 * Deletes are tombstones, not row removals: this data syncs between phones,
 * and a hard-deleted row is resurrected by the other phone's next merge (see
 * `timestamps` in schema.ts). The local file is removed straight away; the
 * reference is cleared so the upload pass never sends a deleted file.
 */
export const docFolderRepo = {
  all(): DocFolder[] {
    return db.select().from(docFolders).where(liveOnly(docFolders)).all();
  },

  byId(id: string): DocFolder | undefined {
    return db
      .select()
      .from(docFolders)
      .where(and(eq(docFolders.id, id), liveOnly(docFolders)))
      .get();
  },

  create(input: Omit<NewDocFolder, 'id'> & { id?: string }): DocFolder {
    return db
      .insert(docFolders)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewDocFolder>): DocFolder | undefined {
    return db
      .update(docFolders)
      .set({ ...patch, updatedAt: now() })
      .where(eq(docFolders.id, id))
      .returning()
      .get();
  },

  /** The folder, every folder beneath it, and every file in any of them. */
  remove(id: string): void {
    const ids = [id, ...descendantIds(docFolderRepo.all(), id)];
    const files = db
      .select()
      .from(docFiles)
      .where(and(inArray(docFiles.folderId, ids), liveOnly(docFiles)))
      .all();
    for (const file of files) docFileRepo.remove(file.id, file);
    db.update(docFolders).set(tombstone()).where(inArray(docFolders.id, ids)).run();
  },
};

export const docFileRepo = {
  /** Every live file, newest first. Metadata only — small even for hundreds. */
  all(): DocFile[] {
    return db.select().from(docFiles).where(liveOnly(docFiles)).orderBy(desc(docFiles.createdAt)).all();
  },

  /** Files directly in one folder (null = top level), pinned first, newest first. */
  inFolder(folderId: string | null): DocFile[] {
    return db
      .select()
      .from(docFiles)
      .where(
        and(folderId ? eq(docFiles.folderId, folderId) : isNull(docFiles.folderId), liveOnly(docFiles)),
      )
      .orderBy(desc(docFiles.pinned), desc(docFiles.createdAt))
      .all();
  },

  byId(id: string): DocFile | undefined {
    return db
      .select()
      .from(docFiles)
      .where(and(eq(docFiles.id, id), liveOnly(docFiles)))
      .get();
  },

  create(input: Omit<NewDocFile, 'id'> & { id?: string }): DocFile {
    return db
      .insert(docFiles)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewDocFile>): DocFile | undefined {
    return db
      .update(docFiles)
      .set({ ...patch, updatedAt: now() })
      .where(eq(docFiles.id, id))
      .returning()
      .get();
  },

  remove(id: string, existing?: DocFile): void {
    const file = existing ?? docFileRepo.byId(id);
    if (file?.imageUri) deletePersistedImage(file.imageUri);
    db.update(docFiles)
      .set({ ...tombstone(), imageUri: null })
      .where(eq(docFiles.id, id))
      .run();
  },
};
