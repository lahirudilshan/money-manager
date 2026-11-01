import './nativeMocks';
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';

/**
 * Not part of the suite (skipped unless MM_TEST_DB is set): runs Smart Detect
 * over a COPY of a real device database and writes, for every message, what
 * the app suggests against what the user actually filed it under.
 */
describe.skipIf(!process.env.MM_TEST_DB)('smart detect on a device snapshot', () => {
  it('reports suggestions', async () => {
    const client = await import('~/db/client');
    client.initialiseDatabase();
    const { useAppStore } = await import('~/store/useAppStore');
    const { parseSms } = await import('~/features/sms/logic/smsParser');
    const { reconcileSms } = await import('~/features/sms/logic/smsReconcile');
    const { learnTransferAmountsFromHistory } = await import('~/store/useAppStore');
    const S = () => useAppStore.getState();
    // What launch does before the first refresh.
    learnTransferAmountsFromHistory();
    S().refresh();
    S().loadSmsDrafts();

    const lineName = (id: string | null | undefined) => {
      const line = S().subcategories.find((s) => s.id === id);
      const cat = line && S().categories.find((c) => c.id === line.categoryId);
      return line ? `${cat?.name} › ${line.name}` : '(none)';
    };
    const board = { subcategories: S().subcategories, categories: S().categories, cards: S().cards };

    const pending = S().smsDrafts.map((d) => ({
      raw: d.parsed.raw.replace(/\s+/g, ' ').slice(0, 160),
      dir: d.parsed.direction,
      kind: d.parsed.kind,
      merchant: d.parsed.merchant,
      amount: d.amountMinor / 100,
      hint: d.hint,
      suggested: lineName(d.subcategoryId),
      confidence: d.confidence,
    }));

    const db = client.expoDb;
    const confirmed = db.getAllSync(`SELECT raw FROM sms_inbox WHERE status = 'confirmed'`) as { raw: string }[];
    const seedOnly = S().merchantRules.filter((r) => r.source !== 'learned');
    const history = confirmed.map(({ raw }) => {
      const txn = db.getFirstSync(
        `SELECT subcategory_id AS sub FROM transactions WHERE note = ? OR note LIKE ?`,
        raw,
        `%${raw.slice(0, 60)}%`,
      ) as { sub: string } | null;
      const state = txn
        ? null
        : (db.getFirstSync(`SELECT subcategory_id AS sub FROM subcategory_states WHERE note = ?`, `From SMS: ${raw}`) as {
            sub: string;
          } | null);
      const chosen = txn?.sub ?? state?.sub ?? null;
      const parsed = parseSms(raw);
      if (!parsed) return { raw: raw.slice(0, 120), parse: 'REJECTED', chosen: lineName(chosen) };
      const withAll = reconcileSms(parsed, board, 'x', S().merchantRules);
      const withSeed = reconcileSms(parsed, board, 'x', seedOnly);
      return {
        raw: raw.replace(/\s+/g, ' ').slice(0, 160),
        dir: parsed.direction,
        kind: parsed.kind,
        merchant: parsed.merchant,
        amount: parsed.amountMinor / 100,
        chosen: lineName(chosen),
        nowSuggests: lineName(withAll.subcategoryId),
        seedSuggests: lineName(withSeed.subcategoryId),
        seedHint: withSeed.hint,
        seedConfidence: withSeed.confidence,
      };
    });

    writeFileSync(process.env.MM_TEST_OUT!, JSON.stringify({ pending, history }, null, 1));
  }, 120_000);
});
