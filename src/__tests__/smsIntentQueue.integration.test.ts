import './harness/nativeMocks';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The "Send Message to Dayly" Shortcuts action, from its queue to a draft.
 *
 * The Swift intent writes each alert as its own file in Documents/.sms-intake.
 * These run the real store drain over that folder: every message becomes a
 * draft, its file goes only once stored, and a message the parser cannot read
 * is kept rather than lost.
 */
let store: typeof import('~/store/useAppStore');
const S = () => store.useAppStore.getState();
// Created by the expo-file-system mock on first import, so read it lazily.
const fs = () => (globalThis as unknown as { __mockFiles: Map<string, string> }).__mockFiles;
const QUEUE = 'file:///app/Documents/.sms-intake';
const LEGACY = 'file:///app/Documents/temp-sms-inbox.txt';

const queued = () => [...fs().keys()].filter((uri) => uri.startsWith(`${QUEUE}/`));
const merchants = () => S().smsDrafts.map((draft) => draft.parsed.merchant.toUpperCase());

beforeAll(async () => {
  (await import('~/db/client')).initialiseDatabase();
  store = await import('~/store/useAppStore');
  S().refresh();
  S().addCard({ nickname: 'Bank', bankId: 'ndb', isCard: false, sortOrder: 0, accountNumber: '106700014567' } as never);
});

describe('Send Message to Dayly', () => {
  it('turns each queued message into a draft and removes its file', () => {
    fs().set(`${QUEUE}/1761990000000-A.txt`, 'LKR 1,200.00 debited from AC XXXXXX4567 as POS TXN on 01 Nov 2026 10:15 at KEELLS SUPER KELANIYA.');
    fs().set(`${QUEUE}/1761990060000-B.txt`, 'LKR 3,450.00 debited from AC XXXXXX4567 as POS TXN on 01 Nov 2026 10:16 at CARGILLS FOOD CITY.');

    expect(S().drainSmsInbox().queued).toBe(2);
    S().loadSmsDrafts();

    expect(merchants().some((m) => m.includes('KEELLS'))).toBe(true);
    expect(merchants().some((m) => m.includes('CARGILLS'))).toBe(true);
    expect(queued()).toHaveLength(0);
  });

  it('a message with "&", "#" and spaces arrives whole — no URL to cut it short', () => {
    const text = 'LKR 2,000.00 debited from AC XXXXXX4567 on 01 Nov 2026 11:00 at H&M #12 COLOMBO.';
    fs().set(`${QUEUE}/1761993600000-C.txt`, text);
    S().drainSmsInbox();
    S().loadSmsDrafts();
    expect(merchants().some((m) => m.includes('H&M'))).toBe(true);
    expect(S().smsDrafts.some((d) => d.parsed.amountMinor === 200_000)).toBe(true);
  });

  it('the same alert sent twice is one draft', () => {
    const before = S().smsDrafts.length;
    const text = 'LKR 1,200.00 debited from AC XXXXXX4567 as POS TXN on 01 Nov 2026 10:15 at KEELLS SUPER KELANIYA.';
    fs().set(`${QUEUE}/1761999999999-D.txt`, text);
    S().drainSmsInbox();
    S().loadSmsDrafts();
    expect(S().smsDrafts.length).toBe(before);
    expect(queued()).toHaveLength(0);
  });

  it('a payment the parser cannot read is parked in the inbox file, not lost', () => {
    const unreadable = 'Your a/c 4567 has a payment of 900 rupees processed, ref 77QX';
    fs().set(`${QUEUE}/1762000000000-E.txt`, unreadable);
    S().drainSmsInbox();
    expect(queued()).toHaveLength(0);
    expect(fs().get(LEGACY) ?? '').toContain(unreadable);
  });

  it('counts waiting messages before they are imported', async () => {
    fs().set(`${QUEUE}/1762000100000-F.txt`, 'LKR 500.00 debited from AC XXXXXX4567 on 01 Nov 2026 12:00 at PICKME.');
    const { countWaiting } = await import('~/features/sms/logic/smsInboxFile');
    expect(countWaiting()).toBeGreaterThanOrEqual(1);
  });
});
