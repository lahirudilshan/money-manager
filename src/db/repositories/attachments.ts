import { expoDb } from '~/db/client';
import { IMAGE_TABLES, type ImageRow, type ImageTable } from '~/features/backup/logic/imageSync';

/**
 * Reading and writing `image_uri` across every table that has one.
 *
 * Eight tables carry an attachment column, and the upload pass needs to walk
 * all of them without caring what else each row holds. Doing that through the
 * eight typed repositories would mean eight near-identical queries and a
 * `switch` that has to be extended every time a table gains a photo.
 *
 * Raw SQL instead, over a fixed allowlist. The table name is interpolated —
 * which is only safe because `IMAGE_TABLES` is a literal array in this
 * codebase, never user input — and the check below makes that explicit rather
 * than leaving it as an assumption a later edit could break.
 */

/** Guard the interpolation: only names this module declared may be used. */
function assertKnownTable(table: string): asserts table is ImageTable {
  if (!(IMAGE_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Unknown attachment table: ${table}`);
  }
}

export const attachmentRepo = {
  /**
   * Every row holding a photo, by table.
   *
   * Rows with no attachment are excluded in SQL rather than filtered after:
   * on a board with thousands of transactions, the ones carrying a receipt are
   * a small minority and there is no reason to read the rest.
   */
  withImages(): Partial<Record<ImageTable, ImageRow[]>> {
    const out: Partial<Record<ImageTable, ImageRow[]>> = {};

    for (const table of IMAGE_TABLES) {
      try {
        const rows = expoDb.getAllSync(
          `SELECT id, image_uri FROM ${table} WHERE image_uri IS NOT NULL AND image_uri <> ''`,
        ) as ImageRow[];
        if (rows.length > 0) out[table] = rows;
      } catch {
        /*
         * A table that does not exist yet is not an error.
         *
         * The mini-app tables are created on first use, so a board that has
         * never opened Fuel has no `fuel_entries`. Skipping it is correct;
         * throwing would make the upload pass fail wholesale because of a
         * feature the user has not touched.
         */
      }
    }

    return out;
  },

  /** Record a new reference against one row, after its upload succeeded. */
  setImageRef(table: ImageTable, rowId: string, stored: string): void {
    assertKnownTable(table);
    expoDb.runSync(`UPDATE ${table} SET image_uri = ? WHERE id = ?`, [stored, rowId]);
  },

  /** How many photos are not in Drive yet, for the settings line. */
  pendingCount(): number {
    let pending = 0;
    for (const rows of Object.values(attachmentRepo.withImages())) {
      for (const row of rows ?? []) {
        // A bare path, or a reference with no `drive:` part, is still local.
        if (row.image_uri && !row.image_uri.includes('drive:')) pending += 1;
      }
    }
    return pending;
  },
};
