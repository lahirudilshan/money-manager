/**
 * Google's free Gemini allowance, as close to "really left" as the phone can know.
 *
 * Google does not offer a "how much is left" call for the free tier. What it
 * does give is:
 *   - a daily allowance PER MODEL (each model has its own),
 *   - a day that ends at midnight Pacific time, not the user's midnight,
 *   - and, when a model runs out, a 429 whose body names the limit
 *     (`"quotaValue": "20"`).
 *
 * So every call is counted here per model per Pacific day, the limit starts at
 * the value measured on 2026-11-07 and is replaced by Google's own number the
 * first time a model runs out, and a model that answered "used up" is shown as
 * empty until the Pacific day turns — whatever the count says.
 */

/** Free requests per model per day, measured 2026-11-07. Replaced by Google's own figure when a 429 states one. */
export const FREE_TIER_DAILY_DEFAULT = 20;

/** Each report read is two requests: one to read the pages, one to explain. */
export const REQUESTS_PER_REPORT = 2;

export interface ModelDay {
  used: number;
  /** Google said this model's daily allowance is used up. */
  exhausted: boolean;
  /** The limit Google stated in a 429, if one has been seen. */
  limit?: number;
}

export interface QuotaLog {
  /** The Pacific day these counts belong to, "YYYY-MM-DD". */
  day: string;
  models: Record<string, ModelDay>;
  /** Limits Google stated, kept across days: they do not change daily. */
  limits: Record<string, number>;
}

export const EMPTY_LOG: QuotaLog = { day: '', models: {}, limits: {} };

/*
 * Pacific time without Intl time zones (Hermes support varies): UTC−8, or
 * UTC−7 from the second Sunday of March 02:00 to the first Sunday of November
 * 02:00 local time — the US rule since 2007.
 */
function nthSunday(year: number, month: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
}

function pacificOffsetHours(at: Date): number {
  const y = at.getUTCFullYear();
  // DST starts 02:00 PST (10:00 UTC), ends 02:00 PDT (09:00 UTC).
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 10);
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 9);
  const t = at.getTime();
  return t >= start && t < end ? -7 : -8;
}

export function pacificDayKey(at: Date): string {
  const shifted = new Date(at.getTime() + pacificOffsetHours(at) * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

/** The moment Google's free allowance next resets. */
export function nextPacificMidnight(at: Date): Date {
  const offset = pacificOffsetHours(at);
  const shifted = new Date(at.getTime() + offset * 3_600_000);
  const midnightShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  );
  // Convert back; the offset at the reset moment can differ on a DST night.
  const guess = new Date(midnightShifted - offset * 3_600_000);
  const actual = pacificOffsetHours(guess);
  return new Date(midnightShifted - actual * 3_600_000);
}

/** The daily limit Google states in a 429 body, if it states one. */
export function quotaValueFrom(body: string): number | null {
  const match =
    /"?quotaValue"?\s*[:=]\s*"?(\d+)/i.exec(body) ?? /\blimit:\s*(\d+)/i.exec(body);
  const n = match ? Number(match[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A 429 that is about the DAY's allowance, not a per-minute burst. */
export function isDailyLimit(status: number, body: string): boolean {
  return status === 429 && /per ?day|requests_per_day|perday|daily/i.test(body);
}

/** The log with one call added. A new Pacific day starts the counts again. */
export function recordCall(
  log: QuotaLog,
  call: { model: string; ok: boolean; status?: number; body?: string; at: Date },
): QuotaLog {
  const day = pacificDayKey(call.at);
  const models = log.day === day ? { ...log.models } : {};
  const limits = { ...log.limits };
  const current: ModelDay = models[call.model] ?? { used: 0, exhausted: false };

  if (call.ok) {
    models[call.model] = { ...current, used: current.used + 1 };
  } else if (call.status !== undefined && isDailyLimit(call.status, call.body ?? '')) {
    const stated = quotaValueFrom(call.body ?? '');
    if (stated) limits[call.model] = stated;
    models[call.model] = { ...current, exhausted: true, limit: stated ?? current.limit };
  } else {
    return log.day === day ? log : { day, models, limits };
  }
  return { day, models, limits };
}

export interface ModelQuota {
  model: string;
  label: string;
  used: number;
  limit: number;
  left: number;
  /** The limit is Google's own figure, not the measured default. */
  fromGoogle: boolean;
}

export interface QuotaSummary {
  models: ModelQuota[];
  requestsLeft: number;
  /** Whole report reads the free allowance still covers today. */
  reportsLeft: number;
  resetsAt: Date;
}

export function modelLabel(model: string): string {
  if (/lite/i.test(model)) return 'Gemini Flash-Lite';
  if (/gemini-3/i.test(model)) return 'Gemini 3 Flash';
  if (/flash/i.test(model)) return 'Gemini Flash';
  return model;
}

export function quotaSummary(log: QuotaLog, models: readonly string[], now: Date): QuotaSummary {
  const today = log.day === pacificDayKey(now) ? log.models : {};
  const rows = models.map((model): ModelQuota => {
    const day = today[model] ?? { used: 0, exhausted: false };
    const stated = day.limit ?? log.limits[model];
    const limit = stated ?? FREE_TIER_DAILY_DEFAULT;
    const left = day.exhausted ? 0 : Math.max(0, limit - day.used);
    return { model, label: modelLabel(model), used: day.used, limit, left, fromGoogle: stated !== undefined };
  });
  const requestsLeft = rows.reduce((n, r) => n + r.left, 0);
  return {
    models: rows,
    requestsLeft,
    reportsLeft: Math.floor(requestsLeft / REQUESTS_PER_REPORT),
    resetsAt: nextPacificMidnight(now),
  };
}

export function parseLog(raw: string | undefined | null): QuotaLog {
  if (!raw) return EMPTY_LOG;
  try {
    const value = JSON.parse(raw) as Partial<QuotaLog>;
    return {
      day: typeof value.day === 'string' ? value.day : '',
      models: value.models && typeof value.models === 'object' ? value.models : {},
      limits: value.limits && typeof value.limits === 'object' ? value.limits : {},
    };
  } catch {
    return EMPTY_LOG;
  }
}
