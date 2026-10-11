import './nativeMocks';
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';

/**
 * Not part of the suite (skipped unless MM_TEST_DB is set): loads a COPY of a
 * real device database through the real migrations and store, and writes every
 * account's figures to MM_TEST_OUT for inspection. Never point it at the
 * original — the migrations write to whatever file they open.
 *
 *   python3 e2e/pull_device_db.py --name mine --udid <UDID>
 *   cp e2e/artifacts/snapshots/mine.db /tmp/copy.db
 *   MM_TEST_DB=/tmp/copy.db MM_TEST_OUT=/tmp/out.json \
 *     node_modules/.bin/vitest run deviceSnapshot
 */
describe.skipIf(!process.env.MM_TEST_DB)('device snapshot', () => {
  it('reports balances', async () => {
    const client = await import('~/db/client');
    client.initialiseDatabase();
    const { useAppStore } = await import('~/store/useAppStore');
    const selectors = await import('~/store/selectors');
    const S = () => useAppStore.getState();
    S().refresh();
    const out: unknown[] = [];
    for (const period of ['2026-08', '2026-09', '2026-10']) {
      S().setPeriod(period);
      const totals = selectors.selectBoardTotals(S());
      out.push({
        period,
        board: { planned: totals.plannedMinor / 100, spent: totals.paidMinor / 100, outstanding: totals.outstandingMinor / 100, income: selectors.selectTotalIncome(S()) / 100 },
        move: selectors.selectAccountTransfers(S()).map((a) => [a.card.nickname, a.plannedMinor / 100, a.toTransferMinor / 100]),
        accounts: selectors.selectCardViews(S()).map((v) => ({
          name: v.card.nickname,
          start: v.card.createdAt,
          balance: v.balanceMinor / 100,
          open: v.flow.openingMinor / 100,
          in: v.flow.inMinor / 100,
          out: v.flow.outMinor / 100,
          close: v.flow.closingMinor / 100,
          toPay: v.committedMinor / 100,
        })),
      });
    }
    const ledgers = selectors.selectAccountLedgers(S());
    const unattributed = S().history.transactions.filter((t) => {
      const line = S().subcategories.find((s) => s.id === t.subcategoryId);
      const cat = line && S().categories.find((c) => c.id === line.categoryId);
      return !(line?.cardId ?? cat?.cardId);
    });
    out.push({ unattributedCount: unattributed.length, unattributedSum: unattributed.reduce((a, t) => a + t.amountMinor, 0) / 100 });
    out.push({
      latestMovements: [...ledgers.values()].map((l) =>
        l.movements.slice(0, 5).map((m) => [m.period, m.kind, m.label, m.amountMinor / 100]),
      ),
    });
    writeFileSync(process.env.MM_TEST_OUT!, JSON.stringify(out, null, 1));
  });
});
