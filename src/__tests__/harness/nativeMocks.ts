/**
 * Stubs for every native module the store's import graph reaches.
 *
 * Import this file FIRST in a test (vi.mock calls inside it are hoisted per
 * file, so it is a setup module rather than a mock list). None of these are
 * exercised by the money paths under test — they exist so the real store and
 * repositories can load in node at all.
 */
import { vi } from 'vitest';

vi.mock('expo-sqlite', async () => {
  const { openNodeDatabase } = await import('./nodeSqlite');
  // MM_TEST_DB points at a COPY of a real database; unset is a fresh one.
  return { openDatabaseSync: () => openNodeDatabase(process.env.MM_TEST_DB ?? ':memory:') };
});
// The barrel also exports `useLiveQuery`, which pulls expo-sqlite's real
// build from inside node_modules where the mock above does not reach.
vi.mock('drizzle-orm/expo-sqlite', async () => import('drizzle-orm/expo-sqlite/driver'));

/*
 * An in-memory file system, so the real SMS inbox drain (the Shortcuts file)
 * runs in tests: `globalThis.__mockFiles` maps a file URI to its text.
 */
vi.mock('expo-file-system', () => {
  const files: Map<string, string> = ((globalThis as Record<string, unknown>).__mockFiles ??=
    new Map<string, string>()) as Map<string, string>;
  const join = (base: unknown, name?: string) => {
    const root = typeof base === 'string' ? base : ((base as { uri?: string })?.uri ?? 'file:///app');
    return name ? `${root.replace(/\/$/, '')}/${name}` : root;
  };
  class Directory {
    uri: string;
    constructor(base?: unknown, name?: string) {
      this.uri = join(base ?? 'file:///app/Documents', name);
    }
    get exists() {
      return true;
    }
    create() {}
    list() {
      return [];
    }
  }
  class File {
    uri: string;
    constructor(base?: unknown, name?: string) {
      this.uri = join(base, name);
    }
    get exists() {
      return files.has(this.uri);
    }
    text() {
      return Promise.resolve(files.get(this.uri) ?? '');
    }
    textSync() {
      return files.get(this.uri) ?? '';
    }
    write(text: string) {
      files.set(this.uri, text);
    }
    create() {
      if (!files.has(this.uri)) files.set(this.uri, '');
    }
    delete() {
      files.delete(this.uri);
    }
    get size() {
      return (files.get(this.uri) ?? '').length;
    }
  }
  return {
    Directory,
    File,
    Paths: { document: new Directory('file:///app/Documents'), cache: new Directory('file:///app/Caches') },
  };
});

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Share: { share: async () => ({}) },
  Linking: { openURL: async () => {}, canOpenURL: async () => false },
  useColorScheme: () => 'light',
}));
vi.mock('react', () => ({ useEffect: () => {}, useState: (v: unknown) => [v, () => {}], useMemo: (f: () => unknown) => f() }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: { glyphMap: {} } }));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} }, executionEnvironment: 'bare' },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));
