/**
 * The shared UI kit.
 *
 * Re-exports the three modules this was split from so `~/shared/components/ui`
 * stays one import for the ~58 files that use it — the split is about keeping
 * each file readable, not about making every screen name a sub-path.
 *
 * Import from here. The modules underneath are an implementation detail, except
 * when you want only the sheet system and nothing else.
 */

export * from './primitives';
export * from './sheet';
export * from './composites';
