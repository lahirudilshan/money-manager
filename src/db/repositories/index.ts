/**
 * Data access, one module per feature.
 *
 * Re-exported here so `~/db/repositories` remains a single import for the files
 * that use several — the split is about keeping each module readable, not about
 * making every caller name a sub-path.
 */

export { createId } from './internal';
export * from './board';
export * from './loans';
export * from './sms';
export * from './fuel';
export * from './health';
export * from './utility';
export * from './settings';
