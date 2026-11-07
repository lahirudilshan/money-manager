import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { SETTINGS_KEYS, settingsRepo } from '~/db/repositories/settings';
import { HISTORY_LIMIT, OPENED_LIMIT, parseHistory, remember } from '../logic/globalSearch';

function read(key: string): string[] {
  try {
    return parseHistory(settingsRepo.get(key));
  } catch {
    return [];
  }
}

function write(key: string, list: string[]): void {
  try {
    settingsRepo.set(key, JSON.stringify(list));
  } catch {
    // History is a convenience; a failed write must never break a search.
  }
}

/** Recent queries and recently opened result keys, kept in the settings table. */
export function useSearchHistory() {
  const [queries, setQueries] = useState(() => read(SETTINGS_KEYS.searchHistory));
  const [opened, setOpened] = useState(() => read(SETTINGS_KEYS.searchOpened));

  const update = useCallback(
    (key: string, set: Dispatch<SetStateAction<string[]>>, next: (list: string[]) => string[]) => {
      set((list) => {
        const value = next(list);
        write(key, value);
        return value;
      });
    },
    [],
  );

  return {
    queries,
    opened,
    addQuery: (q: string) => update(SETTINGS_KEYS.searchHistory, setQueries, (l) => remember(l, q, HISTORY_LIMIT)),
    removeQuery: (q: string) => update(SETTINGS_KEYS.searchHistory, setQueries, (l) => l.filter((e) => e !== q)),
    addOpened: (key: string) => update(SETTINGS_KEYS.searchOpened, setOpened, (l) => remember(l, key, OPENED_LIMIT)),
    clear: () => {
      update(SETTINGS_KEYS.searchHistory, setQueries, () => []);
      update(SETTINGS_KEYS.searchOpened, setOpened, () => []);
    },
  };
}
