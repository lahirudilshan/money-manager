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

vi.mock('expo-file-system', () => {
  class Directory {
    exists = false;
    uri = 'file:///app/x';
    constructor(..._a: unknown[]) {}
    create() {}
    list() {
      return [];
    }
  }
  class File {
    exists = false;
    uri = 'file:///app/x';
    constructor(..._a: unknown[]) {}
    text() {
      return Promise.resolve('');
    }
    textSync() {
      return '';
    }
    write() {}
    delete() {}
  }
  return {
    Directory,
    File,
    Paths: { document: { uri: 'file:///app/Documents/' }, cache: { uri: 'file:///app/Caches/' } },
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
