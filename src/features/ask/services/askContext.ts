import { docFileRepo, docFolderRepo, fuelEntryRepo, healthMedicineRepo, vehicleRepo } from '~/db/repositories';
import { buddyLoanRepo } from '~/db/repositories/buddyLoans';
import { refillRepo, trackedItemRepo } from '~/db/repositories/trackers';
import { useAppStore } from '~/store/useAppStore';
import {
  selectBoardTotals,
  selectCardViews,
  selectCategoryViews,
  selectLoanViews,
  selectTotalIncome,
} from '~/store/selectors';
import { readPersonHealth } from '~/features/health/components/usePersonHealth';
import { buildHealthContext } from '~/features/health/logic/askHealth';
import {
  buildLifeContext,
  buildMoneyContext,
  combineContext,
  SCOPE_AREAS,
  type AskArea,
  type AskScope,
  type MoneyCategory,
} from '~/features/ask/logic/askScope';
import { hasAreaConsent } from './askConsent';

/**
 * The records a question may see, gathered from the store and repositories
 * and shaped by logic/askScope.ts. Only allowed areas are read at all.
 */
export function buildAskContext(
  scope: AskScope,
  options: { personId?: string } = {},
): { text: string; areas: AskArea[]; withheld: AskArea[] } {
  const wanted = SCOPE_AREAS[scope];
  const areas = wanted.filter(hasAreaConsent);
  const withheld = wanted.filter((a) => !areas.includes(a));
  const parts = areas.map((area) => ({
    area,
    text:
      area === 'health'
        ? healthText(scope === 'health' ? options.personId : undefined, scope === 'global')
        : area === 'money'
          ? moneyText()
          : lifeText(),
  }));
  return { text: combineContext(parts, withheld), areas, withheld };
}

/*
 * ---------------------------------------------------------------------------
 * Health
 * ---------------------------------------------------------------------------
 */

function healthText(personId: string | undefined, everyone: boolean): string {
  const people = useAppStore.getState().healthPeople;
  if (people.length === 0) return 'No one is added to Health records yet.';
  const chosen = everyone ? people.slice(0, 4) : [people.find((p) => p.id === personId) ?? people[0]];
  return chosen
    .map((person) => {
      const health = readPersonHealth(person.id);
      return buildHealthContext({
        person: {
          name: person.name,
          age: person.bornOn
            ? Math.floor((Date.now() - person.bornOn.getTime()) / (365.25 * 86_400_000))
            : null,
          sex: person.sex ?? null,
          conditions: person.conditions ?? null,
          allergies: person.allergies ?? null,
        },
        series: health.series.map((s) => ({
          testName: s.testName,
          refLow: s.latest.refLow,
          refHigh: s.latest.refHigh,
          history: s.history,
        })),
        latestReport: health.latestAnalysis
          ? {
              reportDate: health.latestAnalysis.reportDate,
              headline: health.latestAnalysis.headline,
              summary: null,
              watchOut: health.overall?.watchOut ?? [],
            }
          : null,
        medicines: healthMedicineRepo
          .byPerson(person.id)
          .filter((m) => m.isActive)
          .map((m) => [m.name, m.dosage].filter(Boolean).join(' ')),
        today: new Date(),
      });
    })
    .join('\n\n');
}

/*
 * ---------------------------------------------------------------------------
 * Money — summaries only (see askScope.ts)
 * ---------------------------------------------------------------------------
 */

function moneyText(): string {
  const state = useAppStore.getState();
  const totals = selectBoardTotals(state);
  const categories: MoneyCategory[] = selectCategoryViews(state).map((view) => ({
    name: view.category.name,
    plannedMinor: view.summary.plannedTotalMinor,
    actualMinor: view.summary.actualTotalMinor,
    lines: view.subcategories.map((line) => ({
      name: line.name,
      plannedMinor: line.plannedMinor,
      actualMinor: line.actualMinor ?? null,
      status: line.status,
      dueDay: view.rawSubcategories.find((r) => r.id === line.id)?.dueDay ?? null,
      type: line.type === 'income' ? 'income' : 'expense',
    })),
  }));

  // Bank and nickname only — never the account or card number.
  const accounts = selectCardViews(state).map((view) => ({
    label: [view.card.bankName, view.card.nickname].filter(Boolean).join(' · ') || 'Account',
    balanceMinor: view.balanceMinor,
    currency: view.card.currency ?? state.currency,
  }));

  // Paid or spent per month: logged spending plus bills ticked off.
  const byPeriod = new Map<string, number>();
  const incomeLines = new Set(state.history.lines.filter((l) => l.type === 'income').map((l) => l.id));
  for (const t of state.history.transactions) {
    if (incomeLines.has(t.subcategoryId)) continue;
    byPeriod.set(t.period, (byPeriod.get(t.period) ?? 0) + Math.abs(t.amountMinor));
  }
  for (const s of state.history.states) {
    if (incomeLines.has(s.subcategoryId)) continue;
    if (s.status !== 'paid' && s.status !== 'completed') continue;
    const paid = s.paidAmountMinor ?? s.actualMinor ?? 0;
    byPeriod.set(s.period, (byPeriod.get(s.period) ?? 0) + paid);
  }
  const monthly = [...byPeriod.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 6)
    .map(([period, spentMinor]) => ({ period, spentMinor }));

  const loans = selectLoanViews(state)
    .filter((v) => v.loan.isActive)
    .map((v) => ({
      name: v.loan.name,
      installmentMinor: v.installmentMinor,
      remainingMinor: v.remainingMinor,
      paidCount: v.paidCount,
      termMonths: v.loan.termMonths,
    }));

  // Personal loans as totals only — no names of the people involved.
  const open = buddyLoanRepo.all().filter((l) => l.status === 'outstanding');
  const now = Date.now();
  const buddy = {
    lentCount: open.filter((l) => l.direction === 'lent').length,
    lentMinor: open.filter((l) => l.direction === 'lent').reduce((n, l) => n + l.amountMinor, 0),
    borrowedCount: open.filter((l) => l.direction === 'borrowed').length,
    borrowedMinor: open.filter((l) => l.direction === 'borrowed').reduce((n, l) => n + l.amountMinor, 0),
    overdueCount: open.filter((l) => l.dueOn && l.dueOn.getTime() < now).length,
  };

  return buildMoneyContext({
    period: state.period,
    currency: state.currency,
    incomeMinor: selectTotalIncome(state),
    plannedMinor: totals.plannedMinor,
    paidMinor: totals.paidMinor,
    outstandingMinor: totals.outstandingMinor,
    categories,
    accounts,
    monthly,
    loans,
    buddy,
  });
}

/*
 * ---------------------------------------------------------------------------
 * Vehicles, trackers and documents
 * ---------------------------------------------------------------------------
 */

function lifeText(): string {
  const state = useAppStore.getState();
  const today = new Date();
  const monthAgo = today.getTime() - 30 * 86_400_000;

  const vehicles = vehicleRepo
    .all()
    .filter((v) => v.isActive)
    .map((v) => {
      const entries = fuelEntryRepo.byVehicle(v.id);
      const recent = entries.filter((e) => e.filledAt.getTime() >= monthAgo);
      const last = entries.reduce<Date | null>((d, e) => (!d || e.filledAt > d ? e.filledAt : d), null);
      return {
        name: v.name,
        kind: v.kind,
        fills30d: recent.length,
        spent30dMinor: recent.reduce((n, e) => n + (e.totalMinor ?? 0), 0),
        lastFill: last,
      };
    });

  const refills = refillRepo.all();
  const trackers = trackedItemRepo
    .all()
    .filter((t) => !t.archived)
    .map((t) => {
      const own = refills.filter((r) => r.itemId === t.id);
      const last = own.reduce<Date | null>((d, r) => (!d || r.filledOn > d ? r.filledOn : d), null);
      return { name: t.name, unit: t.unitLabel ?? null, expectedDays: t.expectedDays ?? null, lastRefill: last };
    });

  const files = docFileRepo.all();
  const folders = docFolderRepo.all().map((f) => ({
    name: f.name,
    files: files.filter((file) => file.folderId === f.id).length,
  }));

  return buildLifeContext({ currency: state.currency, vehicles, trackers, folders, today });
}
