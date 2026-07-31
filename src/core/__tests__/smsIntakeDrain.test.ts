import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { extractSmsFromUrl } from '../smsIntakeUrl';

/**
 * Guards the SMS deep-link buffer/drain in `app/_layout.tsx`.
 *
 * The layout cannot be imported here (it pulls in expo-router, native modules
 * and the real database), so this reproduces its exact buffer/drain logic over a
 * minimal store. That is enough, because the bug being guarded is purely one of
 * *ordering*, not of React or navigation:
 *
 *   `initialise()` and `Linking.getInitialURL()` are both async. When the
 *   database finishes opening first, `ready` flips to true BEFORE the initial
 *   URL resolves. A handler that only buffers-when-not-ready and relies on a
 *   store subscription to drain then never runs — the last `setState` has
 *   already happened — and the message is dropped with no error.
 *
 * The fix is to drain immediately after buffering as well as on subscription.
 * These tests pin both orderings.
 */

interface TestStore {
  ready: boolean;
  ingested: string[];
  ingestSmsText: (text: string) => void;
}

function makeStore() {
  return create<TestStore>((set, get) => ({
    ready: false,
    ingested: [],
    ingestSmsText: (text: string) => set({ ingested: [...get().ingested, text] }),
  }));
}

/** The layout's handler, verbatim in behaviour. */
function attachIntake(store: ReturnType<typeof makeStore>) {
  const pending: string[] = [];

  const drain = () => {
    const state = store.getState();
    if (!state.ready || pending.length === 0) return;
    for (const text of pending.splice(0)) state.ingestSmsText(text);
  };

  const handle = (url: string | null) => {
    const text = url ? extractSmsFromUrl(url) : null;
    if (!text) return;
    pending.push(text);
    drain();
  };

  const unsubscribe = store.subscribe(drain);
  return { handle, pending, unsubscribe };
}

const URL_ONE = 'moneymanager://sms?text=LKR%20500.00%20debited%20from%20AC%206796';
const URL_TWO = 'moneymanager://sms?text=LKR%20900.00%20debited%20from%20AC%206796';

describe('SMS deep-link drain', () => {
  it('ingests a URL that arrives after the store is ready', () => {
    const store = makeStore();
    const { handle, unsubscribe } = attachIntake(store);
    store.setState({ ready: true });

    handle(URL_ONE);

    expect(store.getState().ingested).toEqual(['LKR 500.00 debited from AC 6796']);
    unsubscribe();
  });

  it('buffers a URL that arrives before ready, then drains on ready', () => {
    const store = makeStore();
    const { handle, pending, unsubscribe } = attachIntake(store);

    handle(URL_ONE);
    expect(store.getState().ingested).toEqual([]);
    expect(pending).toHaveLength(1);

    store.setState({ ready: true });

    expect(store.getState().ingested).toEqual(['LKR 500.00 debited from AC 6796']);
    expect(pending).toHaveLength(0);
    unsubscribe();
  });

  /**
   * The regression this file exists for. `ready` flips before the async
   * `getInitialURL()` settles — the ordering that silently lost the message.
   */
  it('ingests a URL resolving AFTER ready flipped, with no further setState', () => {
    const store = makeStore();
    const { handle, unsubscribe } = attachIntake(store);

    // The store becomes ready first — no more state changes will follow.
    store.setState({ ready: true });

    // Only now does the initial-URL promise settle.
    handle(URL_ONE);

    expect(store.getState().ingested).toEqual(['LKR 500.00 debited from AC 6796']);
    unsubscribe();
  });

  it('drains several buffered messages in arrival order', () => {
    const store = makeStore();
    const { handle, unsubscribe } = attachIntake(store);

    handle(URL_ONE);
    handle(URL_TWO);
    store.setState({ ready: true });

    expect(store.getState().ingested).toEqual([
      'LKR 500.00 debited from AC 6796',
      'LKR 900.00 debited from AC 6796',
    ]);
    unsubscribe();
  });

  it('ignores a URL carrying no text parameter', () => {
    const store = makeStore();
    const { handle, pending, unsubscribe } = attachIntake(store);
    store.setState({ ready: true });

    handle('moneymanager://sms');
    handle(null);

    expect(store.getState().ingested).toEqual([]);
    expect(pending).toHaveLength(0);
    unsubscribe();
  });

  it('handles a warm-start URL arriving long after the first', () => {
    const store = makeStore();
    const { handle, unsubscribe } = attachIntake(store);
    store.setState({ ready: true });

    handle(URL_ONE);
    // A second Shortcut fires later in the same session — the case that
    // "appeared to do nothing" before the listener existed.
    handle(URL_TWO);

    expect(store.getState().ingested).toEqual([
      'LKR 500.00 debited from AC 6796',
      'LKR 900.00 debited from AC 6796',
    ]);
    unsubscribe();
  });
});
