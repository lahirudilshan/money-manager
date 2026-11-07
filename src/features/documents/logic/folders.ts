/**
 * The folder tree, as pure functions over flat rows.
 *
 * Folders are stored flat with a `parentId`; every screen wants a tree view
 * of them — a breadcrumb, a nested picker, a count that includes subfolders.
 * Doing that here keeps the screens free of recursion and makes the cycle
 * guard (a folder moved into its own child) testable.
 */

export interface FolderLike {
  id: string;
  parentId: string | null;
  name: string;
}

export interface FileLike {
  id: string;
  folderId: string | null;
}

/** Guard against a corrupted parent loop: no real tree is this deep. */
const MAX_DEPTH = 32;

const byName = (a: FolderLike, b: FolderLike) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/** Direct children of a folder (null = top level), by name. */
export function childrenOf<F extends FolderLike>(folders: readonly F[], parentId: string | null): F[] {
  return folders.filter((f) => (f.parentId ?? null) === parentId).sort(byName);
}

/**
 * From the top level down to this folder, inclusive. A parent that no longer
 * exists ends the walk, so an orphan reads as top level rather than vanishing.
 */
export function pathOf<F extends FolderLike>(folders: readonly F[], id: string | null): F[] {
  const index = new Map(folders.map((f) => [f.id, f]));
  const path: F[] = [];
  let at = id ? index.get(id) : undefined;
  for (let depth = 0; at && depth < MAX_DEPTH; depth += 1) {
    if (path.includes(at)) break;
    path.unshift(at);
    at = at.parentId ? index.get(at.parentId) : undefined;
  }
  return path;
}

/** "Car / Insurance" — for a search result's subtitle. Empty for the top level. */
export function pathLabel(folders: readonly FolderLike[], id: string | null, separator = ' / '): string {
  return pathOf(folders, id)
    .map((f) => f.name)
    .join(separator);
}

/** Every folder beneath this one (not including it). */
export function descendantIds(folders: readonly FolderLike[], id: string): string[] {
  const out: string[] = [];
  const queue = [id];
  const seen = new Set([id]);
  while (queue.length > 0) {
    const parent = queue.shift() as string;
    for (const f of folders) {
      if (f.parentId === parent && !seen.has(f.id)) {
        seen.add(f.id);
        out.push(f.id);
        queue.push(f.id);
      }
    }
  }
  return out;
}

/**
 * Whether `id` may move into `targetId`. Not into itself, and not into
 * anything beneath it — that would cut the branch off the tree.
 */
export function canMoveInto(folders: readonly FolderLike[], id: string, targetId: string | null): boolean {
  if (targetId === null) return true;
  if (targetId === id) return false;
  return !descendantIds(folders, id).includes(targetId);
}

/** The whole tree, depth-first, for a nested picker. */
export function flattenTree<F extends FolderLike>(
  folders: readonly F[],
  { exclude }: { exclude?: string } = {},
): { folder: F; depth: number }[] {
  const out: { folder: F; depth: number }[] = [];
  const skip = new Set(exclude ? [exclude, ...descendantIds(folders, exclude)] : []);
  const walk = (parentId: string | null, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const folder of childrenOf(folders, parentId)) {
      if (skip.has(folder.id)) continue;
      out.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * Files in each folder INCLUDING its subfolders — what a folder tile shows,
 * since "Car (0)" with twelve files in Car/Insurance would read as empty.
 */
export function deepFileCounts(folders: readonly FolderLike[], files: readonly FileLike[]): Map<string, number> {
  const direct = new Map<string, number>();
  for (const file of files) {
    if (file.folderId) direct.set(file.folderId, (direct.get(file.folderId) ?? 0) + 1);
  }
  const counts = new Map<string, number>();
  for (const folder of folders) {
    let total = direct.get(folder.id) ?? 0;
    for (const child of descendantIds(folders, folder.id)) total += direct.get(child) ?? 0;
    counts.set(folder.id, total);
  }
  return counts;
}
