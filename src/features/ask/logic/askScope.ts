/**
 * Ask AI everywhere — which data a question may see, by where it was asked.
 *
 * ## Scopes and areas
 *
 * A SCOPE is where the question comes from (Health records, the money board,
 * the fuel log, the dashboard). An AREA is a kind of data with its own
 * permission:
 *
 *   health — reports, readings, medicines        (the existing health agreement)
 *   money  — the plan, payments, balances, loans (its own opt-in, SUMMARIES only)
 *   life   — vehicles, trackers, documents       (its own opt-in)
 *
 * A section's scope sends only its own area. The global scope sends every
 * area the user has allowed, and says which ones it left out, so the model
 * never pretends to know what it was not shown.
 *
 * ## Money is summaries only
 *
 * Totals per category and line, statuses, due days, account balances by bank
 * and nickname, loan progress. Never account or card numbers, never SMS text,
 * never notes, never individual payee names from buddy loans. The builders in
 * this file only accept those fields, so nothing else can leak in by accident.
 *
 * Pure: the services gather the data; this shapes it into text.
 */

import { formatMoney } from '~/shared/lib/money';

export type AskScope = 'global' | 'health' | 'money' | 'life';
export type AskArea = 'health' | 'money' | 'life';

export const SCOPE_AREAS: Record<AskScope, readonly AskArea[]> = {
  global: ['health', 'money', 'life'],
  health: ['health'],
  money: ['money'],
  life: ['life'],
};

export const AREA_LABEL: Record<AskArea, string> = {
  health: 'Health records',
  money: 'Money',
  life: 'Vehicles, trackers and documents',
};

/** What each area sends, in one line — shown before agreeing. */
export const AREA_SENDS: Record<AskArea, string> = {
  health: 'Test results, readings, medicines, and each person’s name, age and conditions.',
  money: 'Totals only: monthly plan, bills and their status, spending per category, account balances by bank, loan progress. Never account numbers or SMS text.',
  life: 'Vehicle names and fuel spend, tracked items and refill dates, document folder names and counts.',
};

export interface ScopeMeta {
  title: string;
  /** "Asks about your money" — under the title. */
  intro: string;
  icon: 'sparkles' | 'heart' | 'wallet' | 'car';
}

export const SCOPE_META: Record<AskScope, ScopeMeta> = {
  global: {
    title: 'Ask AI',
    intro: 'Ask about anything in Dayly — your money, health, vehicles and more.',
    icon: 'sparkles',
  },
  health: {
    title: 'Ask about health',
    intro: 'Answers from your saved reports and readings, and the web when needed.',
    icon: 'heart',
  },
  money: {
    title: 'Ask about money',
    intro: 'Answers from your monthly plan, payments and balances.',
    icon: 'wallet',
  },
  life: {
    title: 'Ask about vehicles and more',
    intro: 'Answers from your fuel log, trackers and documents.',
    icon: 'car',
  },
};

/** Which scope a screen belongs to, from its route. */
export function scopeForPath(path: string): AskScope {
  if (path.startsWith('/mini/health')) return 'health';
  if (/^\/(list|loans|transaction|category|subcategory|account|sms)\b/.test(path)) return 'money';
  if (path.startsWith('/mini/buddyloans')) return 'money';
  if (/^\/mini\/(fuel|trackers|documents)\b/.test(path)) return 'life';
  return 'global';
}

/*
 * ---------------------------------------------------------------------------
 * Instructions
 * ---------------------------------------------------------------------------
 */

const BASE_RULES = [
  'You are the assistant inside Dayly, a personal app for a family’s money, health and household. Many readers have little schooling.',
  'Write so a 12-year-old understands: short sentences, everyday words, no jargon.',
  'Answer the question first, in one or two sentences. Then at most 4 short bullet points starting with "- " if they help. Keep the whole answer under 150 words.',
  'Use the SAVED RECORDS below when the question is about the user. Quote the real figure and its date or month.',
  'If the records do not hold the answer, say so plainly and say which part of the app would have it. Never invent a number, a date or a name.',
  'Reply in the same language as the question. Plain text only: no markdown headings, bold, tables or links.',
];

const HEALTH_RULES = [
  'Health: say plainly if a value is normal, high or low, and what to do. You are not a doctor: for medicine or treatment decisions say to ask their doctor; never tell anyone to start, stop or change a medicine.',
  'If the question describes an emergency (chest pain, trouble breathing, fainting, signs of stroke, very high or very low sugar with confusion), tell them to get emergency help now, first.',
];

const MONEY_RULES = [
  'Money: amounts are in the currency shown. Explain what the numbers mean for this month and what to pay or move next.',
  'Do not give investment, tax or legal advice as fact — give general information and suggest asking a qualified person for big decisions.',
];

const WEB_RULE =
  'For general facts (foods, exercise, medicines, interest or exchange rates), use Google Search when it is available and prefer trusted sources.';

export function askInstruction(scope: AskScope, areas: readonly AskArea[]): string {
  const rules = [...BASE_RULES];
  if (areas.includes('health')) rules.push(...HEALTH_RULES);
  if (areas.includes('money')) rules.push(...MONEY_RULES);
  rules.push(WEB_RULE);
  if (scope === 'global') {
    rules.push(
      'The records may cover several parts of the app. Answer from the part the question is about; for "how am I doing" questions give one line per part.',
    );
  }
  return rules.join('\n');
}

/*
 * ---------------------------------------------------------------------------
 * Money, as summaries
 * ---------------------------------------------------------------------------
 */

export interface MoneyLine {
  name: string;
  plannedMinor: number;
  /** What was really paid or spent, when it differs from the plan. */
  actualMinor: number | null;
  status: string;
  dueDay: number | null;
  type: 'income' | 'expense';
}

export interface MoneyCategory {
  name: string;
  plannedMinor: number;
  actualMinor: number;
  lines: readonly MoneyLine[];
}

export interface MoneyInput {
  period: string;
  currency: string;
  incomeMinor: number;
  plannedMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  categories: readonly MoneyCategory[];
  /** "BOC · Salary" — bank and nickname only. */
  accounts: readonly { label: string; balanceMinor: number; currency: string }[];
  /** Spending per month, most recent first. */
  monthly: readonly { period: string; spentMinor: number }[];
  loans: readonly { name: string; installmentMinor: number; remainingMinor: number; paidCount: number; termMonths: number }[];
  buddy: {
    lentCount: number;
    lentMinor: number;
    borrowedCount: number;
    borrowedMinor: number;
    overdueCount: number;
  } | null;
}

const MAX_LINES_PER_CATEGORY = 12;

export function buildMoneyContext(input: MoneyInput): string {
  const m = (minor: number, currency = input.currency) => formatMoney(minor, { currency });
  const lines: string[] = [
    `Month on screen: ${input.period}`,
    `Income expected: ${m(input.incomeMinor)} · Planned to spend: ${m(input.plannedMinor)} · Paid so far: ${m(input.paidMinor)} · Still to pay: ${m(input.outstandingMinor)}`,
  ];

  if (input.categories.length > 0) {
    lines.push('', 'Plan by category (line: planned, paid, status, due day):');
    for (const c of input.categories) {
      lines.push(`- ${c.name}: planned ${m(c.plannedMinor)}, paid ${m(c.actualMinor)}`);
      for (const l of c.lines.slice(0, MAX_LINES_PER_CATEGORY)) {
        lines.push(
          `  · ${l.name}${l.type === 'income' ? ' (income)' : ''}: ${m(l.plannedMinor)}${
            l.actualMinor !== null && l.actualMinor !== l.plannedMinor ? `, actually ${m(l.actualMinor)}` : ''
          }, ${l.status}${l.dueDay ? `, due on the ${l.dueDay}` : ''}`,
        );
      }
      if (c.lines.length > MAX_LINES_PER_CATEGORY) {
        lines.push(`  · and ${c.lines.length - MAX_LINES_PER_CATEGORY} more lines`);
      }
    }
  }

  if (input.accounts.length > 0) {
    lines.push('', 'Account balances now:');
    for (const a of input.accounts) lines.push(`- ${a.label}: ${m(a.balanceMinor, a.currency)}`);
  }

  if (input.monthly.length > 0) {
    lines.push('', 'Spent per month:');
    lines.push(input.monthly.map((x) => `${x.period} ${m(x.spentMinor)}`).join('; '));
  }

  if (input.loans.length > 0) {
    lines.push('', 'Bank loans:');
    for (const l of input.loans) {
      lines.push(
        `- ${l.name}: ${m(l.installmentMinor)} a month, ${l.paidCount} of ${l.termMonths} paid, ${m(l.remainingMinor)} left`,
      );
    }
  }

  if (input.buddy && (input.buddy.lentCount > 0 || input.buddy.borrowedCount > 0)) {
    const b = input.buddy;
    lines.push(
      '',
      `Personal loans: others owe the user ${m(b.lentMinor)} (${b.lentCount}); the user owes ${m(b.borrowedMinor)} (${b.borrowedCount}); ${b.overdueCount} overdue.`,
    );
  }

  return lines.join('\n');
}

/*
 * ---------------------------------------------------------------------------
 * Vehicles, trackers and documents
 * ---------------------------------------------------------------------------
 */

export interface LifeInput {
  currency: string;
  vehicles: readonly { name: string; kind: string; fills30d: number; spent30dMinor: number; lastFill: Date | null }[];
  trackers: readonly { name: string; unit: string | null; expectedDays: number | null; lastRefill: Date | null }[];
  folders: readonly { name: string; files: number }[];
  today: Date;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildLifeContext(input: LifeInput): string {
  const lines: string[] = [`Today: ${day(input.today)}`];
  if (input.vehicles.length > 0) {
    lines.push('', 'Vehicles (last 30 days):');
    for (const v of input.vehicles) {
      lines.push(
        `- ${v.name} (${v.kind}): ${v.fills30d} fill-ups, ${formatMoney(v.spent30dMinor, { currency: input.currency })}${
          v.lastFill ? `, last fill ${day(v.lastFill)}` : ''
        }`,
      );
    }
  }
  if (input.trackers.length > 0) {
    lines.push('', 'Tracked items:');
    for (const t of input.trackers) {
      lines.push(
        `- ${t.name}${t.expectedDays ? `, lasts about ${t.expectedDays} days` : ''}${
          t.lastRefill ? `, last refilled ${day(t.lastRefill)}` : ', never refilled'
        }`,
      );
    }
  }
  if (input.folders.length > 0) {
    lines.push('', 'Document folders:');
    lines.push(input.folders.map((f) => `${f.name} (${f.files})`).join('; '));
  }
  if (lines.length === 1) lines.push('', 'Nothing saved yet for vehicles, trackers or documents.');
  return lines.join('\n');
}

/*
 * ---------------------------------------------------------------------------
 * Putting it together
 * ---------------------------------------------------------------------------
 */

/** The parts the user allowed, each under its own heading, and what was left out. */
export function combineContext(
  parts: readonly { area: AskArea; text: string }[],
  withheld: readonly AskArea[],
): string {
  const out = parts.map((p) => `## ${AREA_LABEL[p.area].toUpperCase()}\n${p.text}`);
  if (withheld.length > 0) {
    out.push(
      `## NOT SHARED\nThe user has not allowed AI to see: ${withheld.map((a) => AREA_LABEL[a]).join(', ')}. If asked about these, say they can allow it in Settings → AI features.`,
    );
  }
  return out.join('\n\n');
}

export const SCOPE_STARTERS: Record<Exclude<AskScope, 'health'>, readonly string[]> = {
  global: [
    'Give me a short summary of my month',
    'What should I take care of this week?',
    'How am I doing with money and health?',
  ],
  money: [
    'Which bills are still unpaid?',
    'How much have I spent this month?',
    'Where can I save money?',
    'How much is in my accounts?',
  ],
  life: [
    'How much did fuel cost this month?',
    'What is running low?',
    'When did I last fill up?',
  ],
};
